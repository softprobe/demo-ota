"""Zero-code Softprobe Python preload for LangGraph and Google ADK demo-ota agents."""

from __future__ import annotations

import os
import re
import site
from pathlib import Path
from typing import Any

_EXTRA_SITE = Path(__file__).resolve().parent / "site-packages"
if _EXTRA_SITE.is_dir():
    site.addsitedir(str(_EXTRA_SITE))

_BOOTSTRAPPED = False
_SESSION_PATH_RE = re.compile(r"/sessions/(ses_[A-Za-z0-9_-]+)")


def _bootstrap() -> None:
    global _BOOTSTRAPPED
    if _BOOTSTRAPPED:
        return
    _BOOTSTRAPPED = True

    if os.environ.get("SOFTPROBE_DISABLED", "").strip().lower() in {"1", "true", "yes"}:
        return

    ingestion_key = (
        os.environ.get("INGESTION_KEY", "").strip()
        or os.environ.get("SOFTPROBE_INGESTION_KEY", "").strip()
    )
    if ingestion_key:
        auth_header = f"Authorization=Bearer {ingestion_key}"
        os.environ.setdefault("OTEL_EXPORTER_OTLP_TRACES_HEADERS", auth_header)
        os.environ.setdefault("OTEL_EXPORTER_OTLP_HEADERS", auth_header)

    traces_endpoint = (
        os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "").strip()
        or os.environ.get("SOFTPROBE_OTLP_ENDPOINT", "").strip()
        or "https://explorer.softprobe.ai/api/thelake/v1/traces"
    )
    os.environ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] = traces_endpoint
    os.environ.setdefault("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "http/protobuf")
    service_name = (
        os.environ.get("SOFTPROBE_AI_SERVICE_NAME", "").strip() or "travel-agent"
    )
    os.environ["OTEL_SERVICE_NAME"] = service_name
    os.environ.setdefault("ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS", "true")
    os.environ.setdefault("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "true")

    if not ingestion_key and "Authorization=" not in os.environ.get(
        "OTEL_EXPORTER_OTLP_TRACES_HEADERS", ""
    ):
        return

    from opentelemetry import baggage as otel_baggage
    from opentelemetry import context as otel_context
    from opentelemetry import propagate as otel_propagate
    from opentelemetry import trace as otel_trace
    from opentelemetry.baggage.propagation import W3CBaggagePropagator
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.propagators.composite import CompositePropagator
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import ReadableSpan, Span, SpanProcessor, TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
    from softprobe.client import SoftprobeClient
    from softprobe.propagation import (
        BaggageSessionSpanProcessor,
        get_propagated_attributes,
        normalize_valid_session_id,
        propagate_attributes,
    )

    otel_propagate.set_global_textmap(
        CompositePropagator([TraceContextTextMapPropagator(), W3CBaggagePropagator()])
    )

    class _SessionDualBaggageProcessor(SpanProcessor):
        def on_start(
            self,
            span: Span,
            parent_context: otel_context.Context | None = None,
        ) -> None:
            ctx = parent_context if parent_context is not None else otel_context.get_current()
            attrs = getattr(span, "attributes", None) or {}
            sid = (
                normalize_valid_session_id(attrs.get("session.id"))
                or normalize_valid_session_id(attrs.get("sp.session.id"))
                or normalize_valid_session_id(attrs.get("gen_ai.conversation.id"))
                or normalize_valid_session_id((get_propagated_attributes() or {}).get("session_id"))
            )
            if sid is None:
                for key in ("session.id", "sp.session.id"):
                    raw = otel_baggage.get_baggage(key, context=ctx)
                    head = raw.split(";", 1)[0] if isinstance(raw, str) else raw
                    sid = normalize_valid_session_id(head)
                    if sid is not None:
                        break
            if sid is not None:
                span.set_attribute("session.id", sid)
                span.set_attribute("sp.session.id", sid)
                span.set_attribute("gen_ai.conversation.id", sid)

        def on_end(self, span: ReadableSpan) -> None:
            return None

        def shutdown(self) -> None:
            return None

        def force_flush(self, timeout_millis: int = 30_000) -> bool:
            return True

    env_name = os.environ.get("SOFTPROBE_ENVIRONMENT", "").strip() or "demo"
    resource = Resource.create(
        {
            "service.name": service_name,
            "deployment.environment.name": env_name,
            "telemetry.sdk.name": "softprobe",
        }
    )
    exporter_headers = (
        {"Authorization": f"Bearer {ingestion_key}"} if ingestion_key else None
    )
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BaggageSessionSpanProcessor())
    provider.add_span_processor(_SessionDualBaggageProcessor())
    provider.add_span_processor(
        SimpleSpanProcessor(
            OTLPSpanExporter(endpoint=traces_endpoint, headers=exporter_headers)
        )
    )
    otel_trace.set_tracer_provider(provider)

    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().instrument(tracer_provider=provider)
    except Exception:
        pass

    try:
        from softprobe.langchain_instrument import auto_instrument_from_env

        sp_client = SoftprobeClient.from_env(
            service_name=service_name,
            environment=env_name,
            use_simple_processor=True,
        )
        handler = auto_instrument_from_env(softprobe_client=sp_client)
    except Exception:
        handler = None

    try:
        import fastapi

        orig_init = fastapi.FastAPI.__init__

        def _patched_fastapi_init(self: Any, *args: Any, **kwargs: Any) -> None:
            orig_init(self, *args, **kwargs)
            app_tracer = provider.get_tracer("softprobe.asgi", "0.1.2")

            @self.middleware("http")
            async def _softprobe_w3c_middleware(request: Any, call_next: Any) -> Any:
                headers = dict(request.headers)
                extracted = otel_propagate.extract(headers)
                sid = None
                for bkey in ("session.id", "sp.session.id"):
                    raw = otel_baggage.get_baggage(bkey, context=extracted)
                    head = raw.split(";", 1)[0] if isinstance(raw, str) else raw
                    sid = normalize_valid_session_id(head)
                    if sid:
                        break
                if sid is None:
                    match = _SESSION_PATH_RE.search(request.url.path)
                    if match:
                        sid = match.group(1)
                if sid:
                    extracted = otel_baggage.set_baggage("session.id", sid, context=extracted)
                    extracted = otel_baggage.set_baggage("sp.session.id", sid, context=extracted)

                token = otel_context.attach(extracted)
                try:
                    with propagate_attributes(session_id=sid):
                        span_name = f"{request.method} {request.url.path}"
                        with app_tracer.start_as_current_span(
                            span_name,
                            kind=otel_trace.SpanKind.SERVER,
                            attributes={
                                "http.request.method": request.method,
                                "url.path": request.url.path,
                                **({"session.id": sid, "sp.session.id": sid} if sid else {}),
                            },
                        ) as server_span:
                            response = await call_next(request)
                            server_span.set_attribute(
                                "http.response.status_code", response.status_code
                            )
                            return response
                finally:
                    otel_context.detach(token)
                    if handler is not None:
                        try:
                            handler.flush()
                        except Exception:
                            pass
                    try:
                        provider.force_flush(timeout_millis=2000)
                    except Exception:
                        pass

        fastapi.FastAPI.__init__ = _patched_fastapi_init  # type: ignore[method-assign]
    except Exception:
        pass


_bootstrap()
