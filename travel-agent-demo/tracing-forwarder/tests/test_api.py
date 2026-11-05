"""HTTP contract tests with a recording callback; no external connections."""

import gzip
import json
import tempfile
import unittest
from email.message import Message
from pathlib import Path

import forwarder as f
from test_forwarder import OTHER_TRACE, SESSION, TRACE, fixture, spans
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

TOKEN = b"unit-test-only-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


class APITests(unittest.TestCase):
    def app(self):
        self.assertTrue(hasattr(f, "Application"), "HTTP application is not implemented")
        self.sent = []

        def transport(body):
            self.sent.append(body)
            return f.Response(200, b"", "application/x-protobuf")

        return f.Application(TOKEN, transport=transport)

    def headers(self, body, path="/register", **extra):
        headers = Message()
        headers["Content-Type"] = "application/json" if path == "/register" else "application/x-protobuf"
        headers["Authorization"] = "Bearer " + (TOKEN.decode() if path == "/register" else "home-demo")
        headers["Content-Length"] = str(len(body))
        for key, value in extra.items():
            if key in headers:
                del headers[key]
            headers[key] = value
        return headers

    def registration(self, trace=TRACE, session=SESSION):
        return json.dumps({"traceId": trace, "sessionId": session}).encode()

    def test_preregister_then_gzipped_descendant_only_batch(self):
        app = self.app()
        body = self.registration()
        result = app.handle("POST", "/register", self.headers(body), body)
        self.assertEqual(result.status, 204)
        self.assertEqual(self.sent, [])
        encoded = gzip.compress(fixture().SerializeToString())
        result = app.handle("POST", "/v1/traces",
                            self.headers(encoded, "/v1/traces", **{"Content-Encoding": "gzip"}), encoded)
        self.assertEqual(result.status, 200)
        self.assertEqual(len(self.sent), 1)
        output = ExportTraceServiceRequest.FromString(self.sent[0])
        for span in spans(output):
            self.assertIn(SESSION, [a.value.string_value for a in span.attributes if a.key == "sp.session.id"])
        self.assertEqual([s.parent_span_id for s in spans(output)],
                         [s.parent_span_id for s in spans(fixture())])

    def test_auth_is_scoped_and_duplicate_authorization_is_rejected(self):
        app = self.app()
        for path, body in (("/register", self.registration()), ("/v1/traces", fixture().SerializeToString())):
            for token in (None, "Bearer wrong-token", "bearer home-demo", "Bearer home-demo, Bearer other"):
                headers = self.headers(body, path)
                del headers["Authorization"]
                if token is not None:
                    headers["Authorization"] = token
                with self.subTest(path=path, token=token), self.assertRaises(f.RequestError) as raised:
                    app.handle("POST", path, headers, body)
                self.assertEqual(raised.exception.status, 401)
            headers = self.headers(body, path)
            headers["Authorization"] = headers["Authorization"]
            with self.assertRaises(f.RequestError) as raised:
                app.handle("POST", path, headers, body)
            self.assertEqual(raised.exception.status, 400)
        body = self.registration()
        with self.assertRaises(f.RequestError) as raised:
            app.handle("POST", "/register", self.headers(body, Authorization="Bearer home-demo"), body)
        self.assertEqual(raised.exception.status, 401)
        self.assertEqual(self.sent, [])

    def test_origin_registration_paths_and_methods_are_closed(self):
        app = self.app()
        body = self.registration()
        for origin in ("null", "https://example.invalid", ""):
            with self.subTest(origin=origin), self.assertRaises(f.RequestError) as raised:
                app.handle("POST", "/register", self.headers(body, Origin=origin), body)
            self.assertEqual(raised.exception.status, 403)
        for path in ("/register?x=1", "/v1/traces?upstream=http://example.invalid", "/v1/logs",
                     "https://example.invalid/v1/traces", "/healthz/", "//v1/traces"):
            with self.subTest(path=path), self.assertRaises(f.RequestError) as raised:
                app.handle("POST", path, self.headers(body), body)
            self.assertEqual(raised.exception.status, 404)
        for method in ("OPTIONS", "PUT", "GET", "HEAD", "DELETE"):
            with self.subTest(method=method), self.assertRaises(f.RequestError) as raised:
                app.handle(method, "/register", {}, b"")
            self.assertEqual(raised.exception.status, 405)
        health = app.handle("GET", "/healthz", {}, b"")
        self.assertEqual((health.status, health.body), (200, b"ok\n"))
        self.assertEqual(self.sent, [])

    def test_registration_json_is_strict_and_conflicts_return_409(self):
        app = self.app()
        malformed = [b"not json", b"[]", b"null", b"{}", b"\xff",
                     b'{"traceId":"' + TRACE.encode() + b'","sessionId":"one","sessionId":"two"}',
                     self.registration(session=""), self.registration(trace="0" * 32),
                     json.dumps({"traceId": TRACE, "sessionId": SESSION, "upstream": "https://example.invalid"}).encode()]
        for body in malformed:
            with self.subTest(body=body), self.assertRaises(f.RequestError) as raised:
                app.handle("POST", "/register", self.headers(body), body)
            self.assertEqual(raised.exception.status, 400)
        body = self.registration()
        app.handle("POST", "/register", self.headers(body), body)
        app.handle("POST", "/register", self.headers(body), body)
        other = self.registration(session="different-session")
        with self.assertRaises(f.RequestError) as raised:
            app.handle("POST", "/register", self.headers(other), other)
        self.assertEqual(raised.exception.status, 409)
        self.assertEqual(self.sent, [])

    def test_content_types_encodings_lengths_and_bad_protobuf_fail_closed(self):
        app = self.app()
        body = fixture().SerializeToString()
        cases = [({"Content-Type": "application/json"}, 415),
                 ({"Content-Type": "text/plain"}, 415),
                 ({"Content-Encoding": "deflate"}, 415),
                 ({"Content-Length": "-1"}, 400), ({"Content-Length": "+1"}, 400),
                 ({"Content-Length": "1, 2"}, 400), ({"Content-Length": "8388609"}, 413),
                 ({"Transfer-Encoding": "chunked"}, 400), ({"Expect": "100-continue"}, 417)]
        for overrides, status in cases:
            with self.subTest(overrides=overrides), self.assertRaises(f.RequestError) as raised:
                app.handle("POST", "/v1/traces", self.headers(body, "/v1/traces", **overrides), body)
            self.assertEqual(raised.exception.status, status)
        for missing in ("Content-Type", "Content-Length"):
            headers = self.headers(body, "/v1/traces")
            del headers[missing]
            with self.assertRaises(f.RequestError):
                app.handle("POST", "/v1/traces", headers, body)
        for duplicate in ("Content-Length", "Content-Type", "Content-Encoding"):
            headers = self.headers(body, "/v1/traces", **{"Content-Encoding": "identity"})
            headers[duplicate] = headers[duplicate]
            with self.assertRaises(f.RequestError) as raised:
                app.handle("POST", "/v1/traces", headers, body)
            self.assertEqual(raised.exception.status, 400)
        for malformed in (b"\xff", b"not-OTLP-protobuf"):
            with self.assertRaises(f.RequestError) as raised:
                app.handle("POST", "/v1/traces", self.headers(malformed, "/v1/traces"), malformed)
            self.assertEqual(raised.exception.status, 400)
        with self.assertRaises(f.RequestError):
            app.handle("POST", "/v1/traces", self.headers(body, "/v1/traces"), body[:-1])
        with self.assertRaises(f.RequestError) as raised:
            data = b" " * 4097
            app.handle("POST", "/register", self.headers(data), data)
        self.assertEqual(raised.exception.status, 413)
        self.assertEqual(self.sent, [])

    def test_token_file_validation_fails_closed(self):
        self.assertTrue(hasattr(f, "load_token"), "token loading is not implemented")
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            path = Path(directory) / "test-token"
            with self.assertRaises(ValueError):
                f.load_token(path)
            for value in (b"", b"home-demo", b"x" * 257, b"x" * 32 + b"\n\n", b"x " * 32):
                path.write_bytes(value)
                with self.subTest(length=len(value)), self.assertRaises(ValueError):
                    f.load_token(path)
            for value in (TOKEN, TOKEN + b"\n", TOKEN + b"\r\n"):
                path.write_bytes(value)
                self.assertEqual(f.load_token(path), TOKEN)


if __name__ == "__main__":
    unittest.main()
