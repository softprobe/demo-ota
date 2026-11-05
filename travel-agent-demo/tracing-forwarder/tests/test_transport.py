"""Transport tests mock urllib's opener: no staging/network writes."""

import io
import json
import ssl
import unittest
import urllib.error
from email.message import Message
from unittest.mock import patch, mock_open

import forwarder as f


class FakeResponse(io.BytesIO):
    def __init__(self, body=b"", status=200, **headers):
        super().__init__(body)
        self.status = status
        self.headers = Message()
        for key, value in headers.items():
            self.headers[key] = value


class TransportTests(unittest.TestCase):
    def setUp(self):
        auth = patch.object(f, "UPSTREAM_AUTHORIZATION", "Bearer spk_offline_fixture")
        auth.start()
        self.addCleanup(auth.stop)

    def test_mounted_workspace_credentials_are_separate_from_local_obi_auth(self):
        config = {"publicKey": "spk_workspace_fixture", "baseUrl": "https://explorer-staging.softprobe.ai/api/thelake", "otlpEndpoint": f.UPSTREAM, "environment": "staging"}
        with patch("builtins.open", mock_open(read_data=json.dumps(config))):
            f.load_upstream_credentials()
        self.assertEqual(f.UPSTREAM_AUTHORIZATION, "Bearer spk_workspace_fixture")
        self.assertEqual(f.OBI_AUTHORIZATION, b"Bearer home-demo")
        for changed in ({"publicKey": "home-demo"}, {"baseUrl": "https://explorer.softprobe.ai/api/thelake"}, {"otlpEndpoint": "https://thelake-staging.softprobe.ai/v1/traces"}):
            with self.subTest(changed=changed), patch("builtins.open", mock_open(read_data=json.dumps({**config, **changed}))):
                with self.assertRaises(ValueError):
                    f.load_upstream_credentials()

    def test_fixed_endpoint_auth_tls_and_disabled_proxy_configuration(self):
        self.assertTrue(hasattr(f, "post_upstream"), "fixed urllib transport is not implemented")
        with patch("forwarder.urllib.request.build_opener") as build:
            build.return_value.open.return_value = FakeResponse(b"upstream-reply", **{"Content-Type": "application/x-protobuf"})
            result = f.post_upstream(b"offline-unit-fixture")
        self.assertEqual((result.status, result.body, result.content_type), (200, b"upstream-reply", "application/x-protobuf"))
        request = build.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://explorer-staging.softprobe.ai/api/thelake/v1/traces")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.data, b"offline-unit-fixture")
        self.assertEqual(request.get_header("Authorization"), "Bearer spk_offline_fixture")
        self.assertEqual(request.get_header("Content-type"), "application/x-protobuf")
        self.assertEqual(request.get_header("User-agent"), "SoftprobeTravelDemo/0.1")
        self.assertIsNone(request.get_header("Content-encoding"))
        self.assertLessEqual(build.return_value.open.call_args.kwargs["timeout"], 30)
        handlers = build.call_args.args
        proxy = next(h for h in handlers if isinstance(h, f.urllib.request.ProxyHandler))
        self.assertEqual(proxy.proxies, {})
        https = next(h for h in handlers if isinstance(h, f.urllib.request.HTTPSHandler))
        self.assertEqual(https._context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(https._context.check_hostname)
        redirect = next(h for h in handlers if isinstance(h, f.urllib.request.HTTPRedirectHandler))
        self.assertIsNone(redirect.redirect_request(request, None, 302, "redirect", {}, "https://example.invalid"))

    def test_redirects_and_transport_failures_are_closed_without_retry(self):
        self.assertTrue(hasattr(f, "post_upstream"), "fixed urllib transport is not implemented")
        headers = Message()
        headers["Location"] = "https://example.invalid/steal"
        failures = [urllib.error.HTTPError("https://unit.invalid", status, "redirect", headers, io.BytesIO(b"redirect-body"))
                    for status in (301, 302, 303, 307, 308)]
        failures.extend([TimeoutError("unit timeout"), urllib.error.URLError("unit connection failure")])
        for failure in failures:
            with self.subTest(failure=type(failure).__name__), patch("forwarder.urllib.request.build_opener") as build:
                build.return_value.open.side_effect = failure
                with self.assertRaises(f.RequestError) as raised:
                    f.post_upstream(b"offline-unit-fixture")
                self.assertEqual(raised.exception.status, 502)
                self.assertEqual(build.return_value.open.call_count, 1)

    def test_upstream_errors_are_returned_but_response_size_is_bounded(self):
        self.assertTrue(hasattr(f, "post_upstream"), "fixed urllib transport is not implemented")
        headers = Message()
        headers["Content-Type"] = "text/plain"
        with patch("forwarder.urllib.request.build_opener") as build:
            build.return_value.open.side_effect = urllib.error.HTTPError("https://unit.invalid", 429, "retry", headers, io.BytesIO(b"busy"))
            result = f.post_upstream(b"offline-unit-fixture")
        self.assertEqual((result.status, result.body), (429, b"busy"))
        for response in (FakeResponse(b"x" * (1024 * 1024 + 1)),
                         FakeResponse(b"", **{"Content-Length": "1048577"}),
                         FakeResponse(b"compressed", **{"Content-Encoding": "gzip"})):
            with patch("forwarder.urllib.request.build_opener") as build:
                build.return_value.open.return_value = response
                with self.assertRaises(f.RequestError) as raised:
                    f.post_upstream(b"offline-unit-fixture")
                self.assertEqual(raised.exception.status, 502)


if __name__ == "__main__":
    unittest.main()
