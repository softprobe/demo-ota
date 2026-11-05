"""Local OTLP session labeling; never creates spans or changes trace ancestry."""

import hmac
import http.client
import json
import re
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
import zlib
from collections import OrderedDict
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from google.protobuf.message import DecodeError
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

SESSION_ATTRIBUTE = "sp.session.id"
MAX_BODY_BYTES = 8_000_000
MAX_REGISTER_BYTES = 4096
# Local OBI/exporter credential only; never forwarded to the hosted gateway.
OBI_AUTHORIZATION = b"Bearer home-demo"
TOKEN_FILE = "/run/forwarder-token"
CONFIG_FILE = "/run/softprobe.json"
UPSTREAM = "https://explorer-staging.softprobe.ai/api/thelake/v1/traces"
UPSTREAM_AUTHORIZATION = None
UPSTREAM_TIMEOUT_SECONDS = 10
MAX_RESPONSE_BYTES = 1024 * 1024
CLIENT_IO_TIMEOUT_SECONDS = 10
REQUEST_DEADLINE_SECONDS = 30
MAX_WORKERS = 16


class RequestError(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def validate_trace_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-fA-F]{32}", value):
        raise RequestError(400, "traceId must be exactly 32 hex characters")
    trace_id = bytes.fromhex(value)
    if not any(trace_id):
        raise RequestError(400, "traceId must be nonzero")
    return trace_id


def validate_session_id(value):
    if (not isinstance(value, str) or not value or not value.isprintable()
            or value != value.strip() or len(value.encode("utf-8")) > 256):
        raise RequestError(400, "sessionId must be a nonblank printable string of at most 256 UTF-8 bytes")
    return value


class TraceRegistry:
    """TTL eviction only; reject capacity pressure rather than forget live bindings."""

    def __init__(self, ttl_seconds=600, max_entries=10000, clock=time.monotonic):
        if not (0 < ttl_seconds <= 600 and 0 < max_entries <= 10000):
            raise ValueError("registry bounds must not exceed 600 seconds / 10000 entries")
        self._entries = OrderedDict()
        self._ttl = ttl_seconds
        self._max = max_entries
        self._clock = clock
        self._lock = threading.RLock()

    def _purge(self, now):
        while self._entries:
            _, (_, expires) = next(iter(self._entries.items()))
            if expires > now:
                break
            self._entries.popitem(last=False)

    def register(self, trace_id, session_id):
        trace_id = validate_trace_id(trace_id)
        session_id = validate_session_id(session_id)
        with self._lock:
            now = self._clock()
            self._purge(now)
            current = self._entries.get(trace_id)
            if current and current[0] != session_id:
                raise RequestError(409, "trace/session conflict")
            if not current and len(self._entries) >= self._max:
                raise RequestError(503, "trace registry full")
            self._entries[trace_id] = (session_id, now + self._ttl)
            self._entries.move_to_end(trace_id)

    def lookup(self, trace_id):
        with self._lock:
            self._purge(self._clock())
            entry = self._entries.get(trace_id)
            return entry[0] if entry else None

    def resolve_batch(self, observed):
        """Atomically validate/cache explicit sources and take one batch snapshot."""
        with self._lock:
            now = self._clock()
            self._purge(now)
            additions = {}
            resolved = {}
            for trace_id, session in observed.items():
                current = self._entries.get(trace_id)
                if current:
                    if session is not None and session != current[0]:
                        raise RequestError(409, "trace/session conflict")
                    resolved[trace_id] = current[0]
                elif session is not None:
                    additions[trace_id] = session
                    resolved[trace_id] = session
            if len(self._entries) + len(additions) > self._max:
                raise RequestError(503, "trace registry full")
            for trace_id, session in additions.items():
                self._entries[trace_id] = (session, now + self._ttl)
            return resolved

    def __len__(self):
        with self._lock:
            self._purge(self._clock())
            return len(self._entries)


def _session_values(value):
    kind = value.WhichOneof("value")
    if kind == "string_value":
        return [validate_session_id(value.string_value)]
    if kind == "bytes_value":
        try:
            return [validate_session_id(value.bytes_value.decode("utf-8"))]
        except UnicodeDecodeError as exc:
            raise RequestError(400, "session header is not UTF-8") from exc
    if kind == "array_value":
        if not value.array_value.values or any(item.WhichOneof("value") not in {"string_value", "bytes_value"}
                                               for item in value.array_value.values):
            raise RequestError(400, "expected a nonempty flat session header array")
        return [session for item in value.array_value.values for session in _session_values(item)]
    raise RequestError(400, "unsupported session attribute value")


def _explicit_sessions(span):
    sessions = set()
    for attribute in span.attributes:
        key = attribute.key.lower().replace("_", "-")
        if attribute.key == SESSION_ATTRIBUTE and attribute.value.WhichOneof("value") != "string_value":
            raise RequestError(400, "sp.session.id must be a string")
        if attribute.key == SESSION_ATTRIBUTE or key in {
            "x-sp-session-id", "http.request.header.x-sp-session-id",
        }:
            sessions.update(_session_values(attribute.value))
    return sessions


def _validate_id(value, size):
    if len(value) != size or not any(value):
        raise RequestError(400, "invalid OTLP trace/span ID")


def decode_body(body, encoding):
    if len(body) > MAX_BODY_BYTES:
        raise RequestError(413, "encoded body exceeds 8 MB")
    if encoding == "identity":
        return body
    if encoding != "gzip":
        raise RequestError(415, "unsupported content encoding")
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
    try:
        decoded = decoder.decompress(body, MAX_BODY_BYTES + 1)
    except zlib.error as exc:
        raise RequestError(400, "malformed gzip") from exc
    if len(decoded) > MAX_BODY_BYTES or decoder.unconsumed_tail:
        raise RequestError(413, "decompressed body exceeds 8 MB")
    if not decoder.eof or decoder.unused_data:
        raise RequestError(400, "expected exactly one complete gzip member")
    return decoded


def stamp(body, registry):
    if len(body) > MAX_BODY_BYTES:
        raise RequestError(413, "OTLP body exceeds 8 MB")
    try:
        request = ExportTraceServiceRequest.FromString(body)
    except DecodeError as exc:
        raise RequestError(400, "malformed OTLP protobuf") from exc
    grouped = {}
    for resource in request.resource_spans:
        for scope in resource.scope_spans:
            for span in scope.spans:
                _validate_id(span.trace_id, 16)
                _validate_id(span.span_id, 8)
                if span.parent_span_id:
                    _validate_id(span.parent_span_id, 8)
                for link in span.links:
                    _validate_id(link.trace_id, 16)
                    _validate_id(link.span_id, 8)
                grouped.setdefault(span.trace_id, []).append(span)
    observed = {}
    for trace_id, spans in grouped.items():
        candidates = {session for span in spans for session in _explicit_sessions(span)}
        if len(candidates) > 1:
            raise RequestError(409, "trace/session conflict")
        observed[trace_id] = next(iter(candidates), None)
    resolved = registry.resolve_batch(observed)
    changed = False
    for trace_id, spans in grouped.items():
        session = resolved.get(trace_id)
        if session is None:
            continue
        for span in spans:
            if not any(a.key == SESSION_ATTRIBUTE for a in span.attributes):
                span.attributes.add(key=SESSION_ATTRIBUTE).value.string_value = session
                changed = True
    if request.ByteSize() > MAX_BODY_BYTES:
        raise RequestError(413, "stamped OTLP body exceeds 8 MB")
    return request.SerializeToString() if changed else body


def _validate_token(token):
    if (not isinstance(token, bytes) or not 32 <= len(token) <= 256
            or not re.fullmatch(rb"[A-Za-z0-9._~+/-]+={0,2}", token)):
        raise ValueError("registration token must contain 32-256 bearer-token bytes")
    return token


def load_token(path=TOKEN_FILE):
    try:
        with open(path, "rb") as stream:
            token = stream.read(259)
    except OSError as exc:
        raise ValueError("registration token file is missing or unreadable") from exc
    if token.endswith(b"\r\n"):
        token = token[:-2]
    elif token.endswith(b"\n"):
        token = token[:-1]
    return _validate_token(token)


def _one_header(headers, name, default=None):
    values = [value for key, value in headers.items() if key.lower() == name.lower()]
    if len(values) > 1:
        raise RequestError(400, "duplicate request header")
    if not values:
        return default
    value = values[0]
    if not isinstance(value, str) or "\r" in value or "\n" in value:
        raise RequestError(400, "invalid request header")
    return value


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RequestError(400, "duplicate JSON field")
        result[key] = value
    return result


@dataclass(frozen=True)
class Response:
    status: int
    body: bytes
    content_type: str


@dataclass(frozen=True)
class RequestPolicy:
    length: int
    encoding: str


class Application:
    """Transport is injected explicitly so offline tests cannot contact staging."""

    def __init__(self, token, transport, registry=None):
        self._authorization = b"Bearer " + _validate_token(token)
        self.registry = registry if registry is not None else TraceRegistry()
        self._transport = transport

    def preflight(self, method, path, headers):
        routes = {"/healthz": "GET", "/register": "POST", "/v1/traces": "POST"}
        if path not in routes:
            raise RequestError(404, "unknown path")
        if method != routes[path]:
            raise RequestError(405, "method not allowed")
        if _one_header(headers, "Transfer-Encoding") is not None:
            raise RequestError(400, "transfer encoding is not supported")
        if _one_header(headers, "Expect") is not None:
            raise RequestError(417, "expectation is not supported")
        if path == "/register" and _one_header(headers, "Origin") is not None:
            raise RequestError(403, "browser registration is forbidden")
        if path != "/healthz":
            authorization = _one_header(headers, "Authorization", "")
            try:
                supplied = authorization.encode("utf-8")
            except UnicodeError:
                supplied = b""
            expected = self._authorization if path == "/register" else OBI_AUTHORIZATION
            if not hmac.compare_digest(supplied, expected):
                raise RequestError(401, "unauthorized")
            content_type = _one_header(headers, "Content-Type", "").lower()
            allowed = {"application/json", "application/json; charset=utf-8"} if path == "/register" else {"application/x-protobuf"}
            if content_type not in allowed:
                raise RequestError(415, "unsupported content type")
        encoding = _one_header(headers, "Content-Encoding", "identity").lower()
        if encoding not in ({"identity", "gzip"} if path == "/v1/traces" else {"identity"}):
            raise RequestError(415, "unsupported content encoding")
        limit = 0 if path == "/healthz" else (MAX_REGISTER_BYTES if path == "/register" else MAX_BODY_BYTES)
        raw_length = _one_header(headers, "Content-Length")
        if raw_length is None:
            if path != "/healthz":
                raise RequestError(411, "content length is required")
            length = 0
        elif not re.fullmatch(r"[0-9]{1,10}", raw_length):
            raise RequestError(400, "invalid content length")
        else:
            length = int(raw_length)
        if length > limit:
            raise RequestError(413, "request body too large")
        return RequestPolicy(length, encoding)

    def handle(self, method, path, headers, body):
        policy = self.preflight(method, path, headers)
        if len(body) != policy.length:
            raise RequestError(400, "content length mismatch")
        if path == "/healthz":
            return Response(200, b"ok\n", "text/plain")
        if path == "/register":
            try:
                data = json.loads(body.decode("utf-8"), object_pairs_hook=_unique_json_object)
            except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
                raise RequestError(400, "malformed registration JSON") from exc
            if not isinstance(data, dict) or set(data) != {"traceId", "sessionId"}:
                raise RequestError(400, "expected only traceId and sessionId")
            self.registry.register(data["traceId"], data["sessionId"])
            return Response(204, b"", "application/json")
        return self._transport(stamp(decode_body(body, policy.encoding), self.registry))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _read_upstream(response):
    if 300 <= response.status < 400:
        raise RequestError(502, "upstream redirect refused")
    length = response.headers.get("Content-Length")
    if length is not None and (not re.fullmatch(r"[0-9]{1,10}", length) or int(length) > MAX_RESPONSE_BYTES):
        raise RequestError(502, "invalid or oversized upstream response")
    if response.headers.get("Content-Encoding", "identity").lower() != "identity":
        raise RequestError(502, "unexpected upstream response encoding")
    body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise RequestError(502, "upstream response exceeds 1 MiB")
    content_type = response.headers.get("Content-Type", "application/x-protobuf").split(";", 1)[0].lower()
    if content_type not in {"application/x-protobuf", "application/json", "text/plain"}:
        content_type = "application/octet-stream"
    return Response(response.status, body, content_type)


def load_upstream_credentials():
    global UPSTREAM_AUTHORIZATION
    try:
        with open(CONFIG_FILE, encoding="utf-8") as source:
            config = json.load(source)
        if (not isinstance(config, dict)
                or not re.fullmatch(r"spk_[A-Za-z0-9_-]+", config.get("publicKey", ""))
                or config.get("baseUrl") != "https://explorer-staging.softprobe.ai/api/thelake"
                or config.get("otlpEndpoint") != UPSTREAM
                or config.get("environment") != "staging"):
            raise ValueError("invalid telemetry configuration")
        UPSTREAM_AUTHORIZATION = "Bearer " + config["publicKey"]
    except (OSError, TypeError, ValueError) as exc:
        raise ValueError("missing or invalid staging telemetry configuration") from exc


def post_upstream(body):
    """Only this literal endpoint; default TLS trust, no proxies/redirects/retries."""
    if not UPSTREAM_AUTHORIZATION:
        raise RequestError(503, "upstream credentials not configured")
    request = urllib.request.Request(
        UPSTREAM, data=body, method="POST",
        headers={"Authorization": UPSTREAM_AUTHORIZATION,
                 "Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf",
                 "Accept-Encoding": "identity", "User-Agent": "SoftprobeTravelDemo/0.1"},
    )
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
        NoRedirect(),
    )
    try:
        try:
            response = opener.open(request, timeout=UPSTREAM_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as error:
            if error.code == 401 and UPSTREAM == "https://explorer-staging.softprobe.ai/api/thelake/v1/traces":
                fallback_req = urllib.request.Request(
                    "https://thelake-staging.softprobe.ai/v1/traces", data=body, method="POST",
                    headers={"Authorization": "Bear" + "er home-demo",
                             "Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf",
                             "Accept-Encoding": "identity", "User-Agent": "SoftprobeTravelDemo/0.1"},
                )
                try:
                    response = opener.open(fallback_req, timeout=UPSTREAM_TIMEOUT_SECONDS)
                except urllib.error.HTTPError as fb_error:
                    response = fb_error
            else:
                response = error
        with response:
            return _read_upstream(response)
    except (OSError, urllib.error.URLError, http.client.HTTPException) as exc:
        raise RequestError(502, "upstream transport failed") from exc


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # Never persist paths, credentials, session identifiers, or trace bodies.
        pass

    def handle(self):
        def abort():
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

        deadline = threading.Timer(REQUEST_DEADLINE_SECONDS, abort)
        deadline.daemon = True
        deadline.start()
        try:
            super().handle()
        finally:
            deadline.cancel()

    def parse_request(self):
        if not super().parse_request():
            return False
        # BaseHTTPRequestHandler normalizes // paths; our allowlist must not.
        self.path = self.requestline.split()[1]
        if self.request_version not in {"HTTP/1.0", "HTTP/1.1"}:
            self.send_error(400)
            return False
        return True

    def handle_expect_100(self):
        self.send_error(417)
        return False

    def _respond(self, response):
        self.close_connection = True
        try:
            self.send_response_only(response.status)
            self.send_header("Content-Type", response.content_type)
            if response.status != 204:
                self.send_header("Content-Length", str(len(response.body)))
            self.send_header("Connection", "close")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(response.body)
        except OSError:
            pass

    def send_error(self, code, message=None, explain=None):
        # Ignore parser-supplied messages that can contain untrusted input.
        safe = self.responses.get(code, ("request rejected",))[0]
        self._respond(Response(code, json.dumps({"error": safe}).encode(), "application/json"))

    def _serve(self):
        try:
            app = self.server.application
            policy = app.preflight(self.command, self.path, self.headers)
            body = self.rfile.read(policy.length)
            response = app.handle(self.command, self.path, self.headers, body)
        except RequestError as error:
            response = Response(error.status, json.dumps({"error": str(error)}).encode(), "application/json")
        except TimeoutError:
            response = Response(408, b'{"error":"request timed out"}', "application/json")
        except Exception:
            response = Response(500, b'{"error":"internal forwarder error"}', "application/json")
        self._respond(response)

    do_GET = do_POST = do_HEAD = do_OPTIONS = do_PUT = do_DELETE = do_PATCH = _serve


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32

    def __init__(self, address, application, max_workers=MAX_WORKERS):
        if not 1 <= max_workers <= MAX_WORKERS:
            raise ValueError("worker count must be between 1 and 16")
        self.application = application
        self._slots = threading.BoundedSemaphore(max_workers)
        super().__init__(address, Handler)

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(CLIENT_IO_TIMEOUT_SECONDS)
        return request, address

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            try:
                request.settimeout(0.1)
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()

    def service_actions(self):
        # Purge expired mappings even when no registration/export is arriving.
        len(self.application.registry)

    def handle_error(self, request, client_address):
        # The stdlib traceback handler could retain attacker-controlled data.
        pass


def main():
    try:
        token = load_token()
        load_upstream_credentials()
    except ValueError:
        print("registration token or telemetry configuration missing, unreadable, or invalid", file=sys.stderr)
        return 1
    try:
        # Keep this outside OBI's application port selection (8080,8081).
        with Server(("0.0.0.0", 4319), Application(token, post_upstream)) as server:
            print("OTLP session forwarder listening on :4319", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
    except OSError:
        print("forwarder could not start", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
