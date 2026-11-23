# demo-ota

Travel OTA reference application for Softprobe demos, tutorials, and end-to-end verification across Arex, Blackbox, UI Testing, and Lisa.

Every application flavor packages into one container exposing port `8080` with zero Docker Compose files inside this repository. Upstream airline inventory uses the hosted NDC 21.3 service at `https://spair.softprobe.ai/ndc/v21.3`.

## Architecture

Each single-container image runs only the processes needed for its flavor behind Nginx on port `8080`:

- `apps/ota-web/` serves the traditional multi-page flight booking web app at `/`.
- `apps/chat-web/` serves the AI travel assistant web app at `/agent` in AI flavors.
- `agents/vercel-ai/`, `agents/langgraph-py/`, and `agents/google-adk-py/` implement the stateless `/agent/api/*` HTTP contract over `contracts/`.
- `services/travel-ota/` runs the Java 21 Spring Boot backend on `127.0.0.1:8081` with all nine `NdcHttpRouter` HTTP client libraries, PostgreSQL persistence on `127.0.0.1:5432`, and `TRV-01` manager-approval policy state.
- `services/ota-sandbox/` runs a static Go service for payment authorization on `127.0.0.1:8082` and confirmation notifications on `127.0.0.1:8083`, plus `/__sandbox/deliveries` inspection.

## Published Docker images

Plain images contain zero Softprobe or OpenTelemetry SDKs:

| Dockerfile | Image tag | Included tiers |
| :--- | :--- | :--- |
| `docker/Dockerfile.java` | `docker.io/softprobe/demo-ota:java` | Java backend, PostgreSQL, payment and notification sandbox |
| `docker/Dockerfile.classic` | `docker.io/softprobe/demo-ota:classic` | Traditional web app at `/`, Java backend, PostgreSQL, sandbox |
| `docker/Dockerfile.vercel-ai` | `docker.io/softprobe/demo-ota:vercel-ai` | `classic` plus chat UI at `/agent` and Node.js Vercel AI agent |
| `docker/Dockerfile.langgraph-py` | `docker.io/softprobe/demo-ota:langgraph-py` | `classic` plus chat UI at `/agent` and Python LangGraph agent |
| `docker/Dockerfile.google-adk-py` | `docker.io/softprobe/demo-ota:google-adk-py` | `classic` plus chat UI at `/agent` and Python Google ADK agent |

Pre-instrumented `-blackbox` images add `@softprobe/web-record`, agent telemetry preloads, and Java OBI or OpenTelemetry capture so tutorials start in one command:

| Dockerfile | Image tag | Pre-installed instrumentation |
| :--- | :--- | :--- |
| `docker/Dockerfile.classic-blackbox` | `docker.io/softprobe/demo-ota:classic-blackbox` | `@softprobe/web-record` plus OBI and Java OTel fallback |
| `docker/Dockerfile.vercel-ai-blackbox` | `docker.io/softprobe/demo-ota:vercel-ai-blackbox` | `classic-blackbox` plus `@softprobe/vercel-ai-sdk` |
| `docker/Dockerfile.langgraph-py-blackbox` | `docker.io/softprobe/demo-ota:langgraph-py-blackbox` | `classic-blackbox` plus `softprobe[langchain]` |
| `docker/Dockerfile.google-adk-py-blackbox` | `docker.io/softprobe/demo-ota:google-adk-py-blackbox` | `classic-blackbox` plus `softprobe` and Google ADK GenAI spans |

## Run with Docker

Run the traditional travel web app and Java backend with Blackbox and UI Testing capture enabled:

```sh
docker run --rm --privileged -p 8080:8080 \
  -e INGESTION_KEY="spk_REPLACE_WITH_INGESTION_KEY" \
  docker.io/softprobe/demo-ota:classic-blackbox
```

To simulate a silent backend regression where `POST /api/flights/book` returns `200 OK` while skipping the confirmation notification request, add `-e OTA_FAULT_SKIP_EMAIL=true`.

Run the full-stack AI travel agent in Node.js Vercel AI, Python LangGraph, or Python Google ADK:

```sh
docker run --rm --privileged -p 8080:8080 \
  -e INGESTION_KEY="spk_REPLACE_WITH_INGESTION_KEY" \
  -e GOOGLE_GENERATIVE_AI_API_KEY="YOUR_GEMINI_API_KEY" \
  docker.io/softprobe/demo-ota:langgraph-py-blackbox
```

Open `http://127.0.0.1:8080/` for the traditional travel site or `http://127.0.0.1:8080/agent` for the AI travel agent. On macOS or non-privileged containers without Linux eBPF tracefs, `-blackbox` images fall back automatically to the OpenTelemetry Java agent on `travel-ota`.

Model provider variables supported across `vercel-ai`, `langgraph-py`, and `google-adk-py`:

- `GOOGLE_GENERATIVE_AI_API_KEY` for Google Gemini
- `OPENAI_API_KEY` for OpenAI
- `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` for Anthropic
- `AI_COMPATIBLE_BASE_URL` and optional `AI_COMPATIBLE_API_KEY` for OpenAI-compatible endpoints

## Local verification

```sh
node tests/check-uninstrumented-source.mjs
(cd services/ota-sandbox && go test ./...)
mvn -B test
node tests/agent-conformance/run-conformance.mjs
```
