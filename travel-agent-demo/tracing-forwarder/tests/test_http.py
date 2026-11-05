"""Real loopback HTTP tests; upstream is always an in-memory callback."""

import contextlib
import gzip
import http.client
import io
import json
import socket
import threading
import time
import unittest
from unittest.mock import patch

import forwarder as f
from test_api import TOKEN
from test_forwarder import SESSION, TRACE, fixture, spans
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest


class HTTPTests(unittest.TestCase):
    def start(self, max_workers=16):
        self.assertTrue(hasattr(f, "Server"), "HTTP server is not implemented")
        self.sent = []

        def transport(body):
            self.sent.append(body)
            return f.Response(200, b"", "application/x-protobuf")

        self.server = f.Server(("127.0.0.1", 0), f.Application(TOKEN, transport), max_workers=max_workers)
        thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()

        def stop():
            self.server.shutdown()
            self.server.server_close()
            thread.join(timeout=2)
        self.addCleanup(stop)
        self.port = self.server.server_address[1]

    def request(self, method, path, body=None, headers=None):
        with contextlib.closing(http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)) as conn:
            conn.request(method, path, body=body, headers=headers or {})
            response = conn.getresponse()
            return response.status, dict(response.getheaders()), response.read()

    def raw(self, request):
        with socket.create_connection(("127.0.0.1", self.port), timeout=2) as conn:
            conn.sendall(request)
            conn.shutdown(socket.SHUT_WR)
            chunks = []
            while chunk := conn.recv(65536):
                chunks.append(chunk)
            return b"".join(chunks)

    def test_health_register_gzip_and_no_sensitive_access_logs(self):
        self.start()
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            status, headers, body = self.request("GET", "/healthz")
            self.assertEqual((status, body), (200, b"ok\n"))
            self.assertEqual(headers.get("Connection"), "close")
            self.assertFalse(any(key.lower().startswith("access-control-") for key in headers))
            data = json.dumps({"traceId": TRACE, "sessionId": SESSION}).encode()
            status, headers, body = self.request("POST", "/register", data,
                {"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN.decode()})
            self.assertEqual(status, 204)
            self.assertEqual(self.server.application.registry.lookup(bytes.fromhex(TRACE)), SESSION)
            encoded = gzip.compress(fixture().SerializeToString())
            status, headers, body = self.request("POST", "/v1/traces", encoded,
                {"Content-Type": "application/x-protobuf", "Authorization": "Bearer home-demo", "Content-Encoding": "gzip"})
            self.assertEqual(status, 200)
            self.assertEqual(len(self.sent), 1)
            expected = fixture()
            for span in spans(expected):
                span.attributes.add(key="sp.session.id").value.string_value = SESSION
            self.assertEqual(ExportTraceServiceRequest.FromString(self.sent[0]), expected)
            self.assertEqual(self.request("GET", "/do-not-log-this-path")[0], 404)
        self.assertEqual(stderr.getvalue(), "")

    def test_http_rejections_happen_before_body_read_or_upstream(self):
        self.start()
        base = (b"POST /v1/traces HTTP/1.1\r\nHost: localhost\r\n"
                b"Content-Type: application/x-protobuf\r\nAuthorization: Bearer home-demo\r\n")
        cases = [(base + b"Content-Length: 8388609\r\n\r\n", 413),
                 (base + b"Content-Length: 2\r\nContent-Length: 2\r\n\r\nxx", 400),
                 (base + b"Transfer-Encoding: chunked\r\nContent-Length: 0\r\n\r\n", 400),
                 (base + b"Content-Length: 20\r\n\r\nshort", 400),
                 (base + b"Expect: 100-continue\r\nContent-Length: 20\r\n\r\n", 417),
                 (base.replace(b"/v1/traces", b"//v1/traces") + b"Content-Length: 0\r\n\r\n", 404),
                 (base.replace(b"Bearer home-demo", b"Bearer nope") + b"Content-Length: 40\r\n\r\n", 401),
                 (base.replace(b"POST", b"OPTIONS", 1) + b"Content-Length: 0\r\n\r\n", 405)]
        for request, expected in cases:
            with self.subTest(expected=expected):
                response = self.raw(request)
                self.assertEqual(int(response.split(b" ", 2)[1]), expected, response)
                self.assertNotIn(b"100 Continue", response)
                self.assertNotIn(b"Access-Control", response)
        self.assertEqual(self.sent, [])

    def test_worker_capacity_is_bounded(self):
        self.start(max_workers=1)
        self.assertTrue(self.server._slots.acquire(blocking=False))
        try:
            self.assertEqual(self.request("GET", "/healthz")[0], 503)
        finally:
            self.server._slots.release()
        self.assertEqual(self.request("GET", "/healthz")[0], 200)

    def test_slow_headers_are_cut_off_by_absolute_deadline(self):
        with patch.object(f, "REQUEST_DEADLINE_SECONDS", 0.15, create=True):
            self.start()
            started = time.monotonic()
            with socket.create_connection(("127.0.0.1", self.port), timeout=2) as conn:
                conn.sendall(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nX-Slow: ")
                conn.recv(65536)
            self.assertLess(time.monotonic() - started, 1.5)
        self.assertEqual(self.sent, [])

    def test_main_requires_mounted_token_and_uses_fixed_bind_address(self):
        self.assertTrue(hasattr(f, "main"), "entry point is not implemented")
        with patch("forwarder.load_token", return_value=TOKEN) as load, patch("forwarder.load_upstream_credentials") as credentials, patch("forwarder.Server") as server:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(f.main(), 0)
            load.assert_called_once_with()
            credentials.assert_called_once_with()
            self.assertEqual(f.TOKEN_FILE, "/run/forwarder-token")
            self.assertEqual(server.call_args.args[0], ("0.0.0.0", 4319))
            self.assertIs(server.call_args.args[1]._transport, f.post_upstream)
            server.return_value.__enter__.return_value.serve_forever.assert_called_once()
        stderr = io.StringIO()
        with patch("forwarder.load_token", side_effect=ValueError("do-not-log-secret")), patch("forwarder.Server") as server:
            with contextlib.redirect_stderr(stderr):
                self.assertEqual(f.main(), 1)
            server.assert_not_called()
        self.assertNotIn("do-not-log-secret", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
