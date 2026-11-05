"""Offline unit tests: all traces are local fixtures, never submitted."""

import importlib.util
import unittest

from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

TRACE = "0123456789abcdef0123456789abcdef"
OTHER_TRACE = "fedcba9876543210fedcba9876543210"
SESSION = "local-unit-test-session"


def fixture(trace_id=TRACE):
    request = ExportTraceServiceRequest()
    resource = request.resource_spans.add()
    resource.schema_url = "https://example.invalid/resource-schema"
    resource.resource.attributes.add(key="service.name").value.string_value = "fixture"
    scope = resource.scope_spans.add()
    scope.scope.name = "test-scope"
    scope.scope.version = "1"
    scope.schema_url = "https://example.invalid/scope-schema"
    for i in range(1, 4):
        span = scope.spans.add(
            trace_id=bytes.fromhex(trace_id),
            span_id=i.to_bytes(8, "big"),
            parent_span_id=(i + 10).to_bytes(8, "big"),
            name=f"span-{i}",
            trace_state="test=value",
            flags=0x301,
            start_time_unix_nano=1000,
            end_time_unix_nano=2000,
            kind=2,
        )
        span.attributes.add(key="http.request.body").value.string_value = '{"keep":"body"}'
        span.attributes.add(key="http.response.body").value.bytes_value = b"raw-response"
        span.events.add(name="test-event", time_unix_nano=1500)
        span.links.add(trace_id=bytes.fromhex(OTHER_TRACE), span_id=b"linkspan")
        span.status.message = "keep status"
    return request


def spans(request):
    return [span for resource in request.resource_spans
            for scope in resource.scope_spans for span in scope.spans]


class ForwarderTests(unittest.TestCase):
    def module(self):
        self.assertIsNotNone(importlib.util.find_spec("forwarder"), "forwarder is not implemented")
        import forwarder
        return forwarder

    def test_preregister_stamps_descendants_without_changing_parentage_or_bodies(self):
        f = self.module()
        registry = f.TraceRegistry()
        registry.register(TRACE, SESSION)
        original = fixture()
        original.resource_spans.add().scope_spans.add().spans.add().CopyFrom(spans(fixture(OTHER_TRACE))[0])
        expected = ExportTraceServiceRequest()
        expected.CopyFrom(original)
        for span in spans(expected)[:3]:
            span.attributes.add(key="sp.session.id").value.string_value = SESSION
        actual = ExportTraceServiceRequest.FromString(f.stamp(original.SerializeToString(), registry))
        self.assertEqual(actual, expected)

    def test_conflicting_unexpired_registration_cannot_overwrite(self):
        f = self.module()
        registry = f.TraceRegistry()
        registry.register(TRACE, SESSION)
        registry.register(TRACE, SESSION)  # Idempotent retry.
        with self.assertRaisesRegex(ValueError, "conflict"):
            registry.register(TRACE, "different-session")
        self.assertEqual(registry.lookup(bytes.fromhex(TRACE)), SESSION)

    def test_register_rejects_invalid_identifiers_without_repairing_them(self):
        f = self.module()
        registry = f.TraceRegistry()
        for trace in (None, 123, "", "0" * 32, "a" * 31, "g" * 32, " " + TRACE, TRACE + "\n"):
            with self.subTest(trace=trace), self.assertRaises(ValueError):
                f.TraceRegistry().register(trace, SESSION)
        for session in (None, 123, True, "", " ", "trim-me ", "line\nbreak", "x\x00y", "x" * 257):
            with self.subTest(session=repr(session)), self.assertRaises(ValueError):
                f.TraceRegistry().register(TRACE, session)

    def test_registry_expiry_capacity_and_thread_safety(self):
        from concurrent.futures import ThreadPoolExecutor
        f = self.module()
        now = [0.0]
        registry = f.TraceRegistry(ttl_seconds=600, max_entries=1, clock=lambda: now[0])
        registry.register(TRACE, SESSION)
        now[0] = 599
        self.assertEqual(registry.lookup(bytes.fromhex(TRACE)), SESSION)
        with self.assertRaisesRegex(ValueError, "full"):
            registry.register(OTHER_TRACE, SESSION)
        now[0] = 600
        self.assertIsNone(registry.lookup(bytes.fromhex(TRACE)))
        registry.register(TRACE, "after-expiry")
        self.assertEqual(len(registry), 1)
        now[0] = 1200
        self.assertEqual(len(registry), 0)

        def attempt(i):
            try:
                registry.register(f"{i:032x}", SESSION)
                return True
            except ValueError:
                return False
        with ThreadPoolExecutor(max_workers=16) as pool:
            self.assertEqual(sum(pool.map(attempt, range(1, 65))), 1)
        self.assertEqual(len(registry), 1)

        default = f.TraceRegistry()
        for i in range(1, 10001):
            default.register(f"{i:032x}", SESSION)
        with self.assertRaisesRegex(ValueError, "full"):
            default.register(OTHER_TRACE, SESSION)
        self.assertEqual(len(default), 10000)

    def test_same_batch_explicit_labels_and_headers_propagate_to_earlier_spans_and_cache(self):
        f = self.module()
        cases = [("sp.session.id", "string"),
                 ("http.request.header.x-sp-session-id", "string"),
                 ("http.request.header.x_sp_session_id", "array"),
                 ("X-SP-Session-ID", "bytes")]
        for key, kind in cases:
            with self.subTest(key=key, kind=kind):
                registry = f.TraceRegistry()
                body = fixture()
                value = spans(body)[-1].attributes.add(key=key).value
                if kind == "string":
                    value.string_value = SESSION
                elif kind == "bytes":
                    value.bytes_value = SESSION.encode()
                else:
                    value.array_value.values.add().string_value = SESSION
                output = ExportTraceServiceRequest.FromString(f.stamp(body.SerializeToString(), registry))
                for span in spans(output):
                    labels = [a.value.string_value for a in span.attributes if a.key == "sp.session.id"]
                    self.assertEqual(labels, [SESSION])
                # The cached label joins later batches with no captured header.
                later = ExportTraceServiceRequest.FromString(f.stamp(fixture().SerializeToString(), registry))
                self.assertTrue(all(any(a.key == "sp.session.id" and a.value.string_value == SESSION
                                        for a in span.attributes) for span in spans(later)))
                # Re-exporting does not accumulate labels or rewrite an existing one.
                self.assertEqual(f.stamp(output.SerializeToString(), registry), output.SerializeToString())

    def test_conflicting_batch_is_atomic_and_does_not_poison_registry(self):
        f = self.module()
        registry = f.TraceRegistry()
        registry.register(OTHER_TRACE, "registered-session")
        body = fixture()
        spans(body)[0].attributes.add(key="sp.session.id").value.string_value = SESSION
        extra = body.resource_spans.add().scope_spans.add().spans.add()
        extra.CopyFrom(spans(fixture(OTHER_TRACE))[0])
        extra.attributes.add(key="http.request.header.x-sp-session-id").value.string_value = "wrong-session"
        with self.assertRaisesRegex(ValueError, "conflict"):
            f.stamp(body.SerializeToString(), registry)
        self.assertIsNone(registry.lookup(bytes.fromhex(TRACE)))
        self.assertEqual(registry.lookup(bytes.fromhex(OTHER_TRACE)), "registered-session")

    def test_rejects_malformed_protobuf_and_invalid_span_ids_before_caching(self):
        f = self.module()
        for field, value in (("trace_id", b""), ("trace_id", b"0" * 15), ("trace_id", b"\0" * 16),
                             ("span_id", b"x"), ("span_id", b"\0" * 8),
                             ("parent_span_id", b"x"), ("parent_span_id", b"\0" * 8)):
            with self.subTest(field=field, value=value):
                registry = f.TraceRegistry()
                body = fixture()
                spans(body)[0].attributes.add(key="sp.session.id").value.string_value = SESSION
                setattr(spans(body)[-1], field, value)
                with self.assertRaises(ValueError):
                    f.stamp(body.SerializeToString(), registry)
                self.assertEqual(len(registry), 0)
        with self.assertRaises(ValueError):
            f.stamp(b"\xff", f.TraceRegistry())

    def test_unrelated_spans_and_unknown_protobuf_fields_are_preserved(self):
        f = self.module()
        body = fixture()
        spans(body)[0].attributes.add(key="not-an-x-sp-session-id").value.string_value = "not-a-session-source"
        spans(body)[0].attributes.add(key="SP.SESSION.ID").value.string_value = "case-sensitive-attribute-is-not-a-source"
        body.resource_spans[0].resource.attributes.add(key="sp.session.id").value.string_value = "not-span-level"
        # Unknown field 127, varint 1 is preserved by protobuf round-tripping.
        wire = body.SerializeToString() + b"\xf8\x07\x01"
        registry = f.TraceRegistry()
        self.assertEqual(f.stamp(wire, registry), wire)
        self.assertEqual(len(registry), 0)
        registry.register(TRACE, SESSION)
        expected = ExportTraceServiceRequest.FromString(wire)
        for span in spans(expected):
            span.attributes.add(key="sp.session.id").value.string_value = SESSION
        output = ExportTraceServiceRequest.FromString(f.stamp(wire, registry))
        self.assertEqual(output, expected)

    def test_gzip_is_bounded_and_malformed_input_is_rejected(self):
        import gzip
        f = self.module()
        self.assertTrue(hasattr(f, "decode_body"), "bounded gzip decoding is not implemented")
        wire = fixture().SerializeToString()
        self.assertEqual(f.decode_body(wire, "identity"), wire)
        self.assertEqual(f.decode_body(gzip.compress(wire), "gzip"), wire)
        limit = 8_000_000  # Decimal MB: never exceed the requested <=8 MB bound.
        self.assertEqual(f.MAX_BODY_BYTES, limit)
        self.assertEqual(len(f.decode_body(gzip.compress(b"x" * limit), "gzip")), limit)
        oversized = [(b"x" * (limit + 1), "identity"),
                     (gzip.compress(b"x" * (limit + 1)), "gzip")]
        for data, encoding in oversized:
            with self.subTest(encoding=encoding), self.assertRaises(f.RequestError) as raised:
                f.decode_body(data, encoding)
            self.assertEqual(raised.exception.status, 413)
        valid = gzip.compress(wire)
        invalid = [b"not gzip", valid[:-1], valid + b"junk", valid + valid,
                   valid[:-8] + b"\0" * 8]
        for data in invalid:
            with self.subTest(data_length=len(data)), self.assertRaises(f.RequestError) as raised:
                f.decode_body(data, "gzip")
            self.assertEqual(raised.exception.status, 400)
        for encoding in ("deflate", "br", "gzip, gzip"):
            with self.subTest(encoding=encoding), self.assertRaises(f.RequestError) as raised:
                f.decode_body(valid, encoding)
            self.assertEqual(raised.exception.status, 415)

    def test_stamped_output_also_obeys_body_limit(self):
        f = self.module()
        registry = f.TraceRegistry()
        registry.register(TRACE, SESSION)
        request = fixture()
        value = spans(request)[0].attributes.add(key="large-fixture").value
        value.bytes_value = b"x" * (8_000_000 - 1000)
        remaining = 8_000_000 - request.ByteSize()
        value.bytes_value += b"x" * remaining
        self.assertEqual(request.ByteSize(), 8_000_000)
        with self.assertRaises(f.RequestError) as raised:
            f.stamp(request.SerializeToString(), registry)
        self.assertEqual(raised.exception.status, 413)

    def test_invalid_session_value_shapes_and_link_ids_fail_closed(self):
        f = self.module()
        for kind in ("canonical-bytes", "empty-array", "nested-array", "bad-link"):
            with self.subTest(kind=kind):
                request = fixture()
                span = spans(request)[0]
                if kind == "canonical-bytes":
                    span.attributes.add(key="sp.session.id").value.bytes_value = SESSION.encode()
                elif kind == "empty-array":
                    span.attributes.add(key="x-sp-session-id").value.array_value.SetInParent()
                elif kind == "nested-array":
                    span.attributes.add(key="x-sp-session-id").value.array_value.values.add().array_value.values.add().string_value = SESSION
                else:
                    span.links[0].trace_id = b"short"
                with self.assertRaises(f.RequestError) as raised:
                    f.stamp(request.SerializeToString(), f.TraceRegistry())
                self.assertEqual(raised.exception.status, 400)


if __name__ == "__main__":
    unittest.main()
