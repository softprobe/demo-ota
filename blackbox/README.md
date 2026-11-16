# Blackbox End-to-End Session Tracing Overlay

Run the three-tier Travel OTA demo (`travel-web` browser, `travel-agent` Vercel AI server, and `travel-ota` Java backend) with Softprobe Blackbox instrumentation and OBI HTTP payload capture.

The base `demo-ota` application and `travel-ota/Dockerfile` stay uninstrumented. This overlay adds instrumentation at container startup.

## Run with Docker Compose

1. Create an Agent in [Softprobe Explorer](https://explorer.softprobe.ai) (`+ Connect agent`, **Vercel AI**) and copy its Ingestion Key (`spk_...`).
2. Start the demo stack:

```bash
export INGESTION_KEY="spk_REPLACE_WITH_INGESTION_KEY"
export GOOGLE_GENERATIVE_AI_API_KEY="YOUR_GEMINI_API_KEY"
docker compose -f compose.blackbox.yml up --build
```

3. Open [`http://127.0.0.1:4310/agent`](http://127.0.0.1:4310/agent), search and book a flight, then inspect the correlated Session in Explorer.

For staging Explorer, also set:

```bash
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="https://explorer-staging.softprobe.ai/api/thelake/v1/traces"
export OTEL_RESOURCE_ATTRIBUTES="deployment.environment.name=staging"
export SOFTPROBE_ENVIRONMENT="staging"
```

## How the three tiers are instrumented

| Tier | Service name | Mechanism |
|------|--------------|-----------|
| **Browser (`travel-web`)** | `travel-web` | `<script src="/agent/web-record.js" data-softprobe-options='...' defer>` from `@softprobe/web-record` |
| **Vercel AI server (`travel-agent`)** | `travel-agent` | `NODE_OPTIONS="--import /opt/blackbox/init-vercel-ai.mjs"` calling `initVercelAiTelemetry()` from `@softprobe/vercel-ai-sdk` |
| **Java backend (`travel-ota`)** | `travel-ota` | Official OpenTelemetry OBI `v1.0.0` sidecar using `blackbox/obi.yaml` |
