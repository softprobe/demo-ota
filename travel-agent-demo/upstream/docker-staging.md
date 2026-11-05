# Run the travel demo in Docker and send traces to staging

The travel demo is the booking UI (`softprobe/sp-ota`) plus the airline mock (`softprobe/sp-airline`). The pages load `@softprobe/web`, which records the browser with rrweb and stamps `x-sp-session-id` on same-origin calls. This guide runs that UI with Docker Compose. Kubernetes is not required.

Files for this path live in this directory:

- `docker-staging.md` — this guide
- `docker-compose.staging.yaml` — UI, airline mock, and OBI
- `obi-docker.yml` — header and body capture for OBI
- `travel-ui-web/` — pages and the built `@softprobe/web` script

Staging ingest is `https://thelake-staging.softprobe.ai`. View sessions at `https://explorer-staging.softprobe.ai`.

## Staging authentication

Staging requires a Bearer token. A request with no `Authorization` header returns **401**.

It does **not** require a provisioned Softprobe API key. The staging deployment sets `SOFTPROBE_DEFAULT_WORKSPACE_ID`, so any non-empty Bearer is accepted and stored in workspace `4ccbdde6-0f8b-48f0-8af0-04f67f73fade`. The token is not sent to the auth service. `home-demo` is the token already used by the home demo, and staging accepts it.

`@softprobe/web` sends that token as `Authorization: Bearer <data-public-key>` on `POST /v1/traces` (OTLP JSON). OBI sends the same header on OTLP protobuf.

Use the public HTTPS endpoint. The ingress publishes thelake HTTP on port 8080. OTLP/gRPC `:4317` stays inside the cluster.

Browser posts are allowed from the Docker UI. thelake answers with permissive CORS, so a page on `http://localhost:8080` can post to staging.

## What each piece sends

| Piece | What it sends | Session id |
| --- | --- | --- |
| `@softprobe/web` | rrweb batches as span `softprobe.web.recording` | `sp.session.id`, also stored in `sessionStorage` under `x-sp-session-id` |
| OBI | HTTP traces for the UI (`:8080`) and the airline (`:8081`), including the request header `x-sp-session-id` on browser calls | Header attribute on the UI span. OBI does not copy it onto every span |

The script only adds `x-sp-session-id` to `fetch` and `XMLHttpRequest` that go to the same origin as the page. Serve the pages from the travel-ui container. Opening the HTML as a file will not hit the API.

## Prepare the pages

From this directory:

```bash
mkdir -p .staging-web/js
cp travel-ui-web/index.html travel-ui-web/booking.html \
   travel-ui-web/payment.html travel-ui-web/orders.html .staging-web/
cp travel-ui-web/softprobe-session.js .staging-web/js/
perl -pi -e \
  's|data-base-url="[^"]*"|data-base-url="https://thelake-staging.softprobe.ai"|;
   s|data-public-key="[^"]*"|data-public-key="home-demo"|' \
  .staging-web/*.html
```

`.staging-web/` is a local copy. The HTML in git still points at the home-lab thelake (`http://10.0.0.170:30091`). `softprobe-session.js` is the built `@softprobe/web` bundle. Rebuild it from `softprobe-js` (`npm run build -w @softprobe/web`) only when you change that package, then copy `packages/web/dist/softprobe-session.js` over `.staging-web/js/softprobe-session.js`.

## Start the demo

Docker Engine, or Docker Desktop. From this directory, after the prepare step:

```bash
docker compose -f docker-compose.staging.yaml up
```

Open `http://localhost:8080` and run a search, booking, payment, or order lookup.

In the browser devtools, `sessionStorage` key `x-sp-session-id` is the session id (shape `sp-session-…`). The page posts to `https://thelake-staging.softprobe.ai/v1/traces` a few seconds after activity. A **200** means staging stored the batch. Staging flushes ingest about every 2 seconds.

Then open `https://explorer-staging.softprobe.ai` and find that session id. Recording spans are kept for replay and are omitted from session token counts, so a browser-only visit can look thin until HTTP spans arrive.

Confirm from a shell:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'Authorization: Bearer home-demo' \
  -H 'Content-Type: application/json' \
  -d '{"from":"2026-01-01T00:00:00Z","to":"2100-01-01T00:00:00Z","limit":5}' \
  https://thelake-staging.softprobe.ai/v1/sessions/search
```

`200` means the token and the search API are working. `401` means the Bearer header was missing.

## OBI in Docker

Yes. OBI (`otel/ebpf-instrument:v0.15.2`, the same image as the home cluster) runs as a privileged container with the host PID namespace and instruments the other containers. The Compose file already starts it.

It has to see the Java processes, so the UI and the airline run as containers on the same Docker engine. OBI selects them by the port they listen on inside the container (`8080` and `8081`), which is what `OTEL_EBPF_OPEN_PORT` matches.

Requirements:

- Privileged container, plus `pid: host`.
- Linux, or Docker Desktop’s Linux VM. A JVM started on macOS outside Docker is invisible to OBI.
- `/sys/kernel/tracing` and `/sys/fs/cgroup` mounted when context propagation is on, so later hops can stay on one trace.

`obi-docker.yml` keeps request bodies and the `x-sp-session-id` request header, and drops other headers. OBI exports OTLP protobuf to `https://thelake-staging.softprobe.ai` with `Authorization=Bearer home-demo`.

If OBI logs that it cannot load eBPF or that BTF is missing, the kernel inside Docker does not expose the probes. That is a host limitation. The browser script still sends recordings without OBI. To run the UI alone:

```bash
docker compose -f docker-compose.staging.yaml up travel-ui demo-airline
```

The home cluster also runs a small `session-stamp` forwarder in front of thelake. It copies `x-sp-session-id` onto `sp.session.id` for every span in the trace. That forwarder’s upstream is the in-cluster thelake, so this Compose sends OBI straight to staging. Browser recordings already set `sp.session.id`. Server spans carry the header attribute.

## Left on the cluster

This Compose does not start Mongo, the Java record/replay agent, or the NDC `demo-ota` service. Those belong to the Kubernetes manifests in this directory. The booking pages talk to `softprobe/sp-ota`, which calls the airline mock at `http://demo-airline:8081/airline-api/v1`.
