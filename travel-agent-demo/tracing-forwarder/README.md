# Local OTLP session-labeling forwarder

Private demo sidecar adapted from [Bill's session-stamp at the supplied revision](https://github.com/softprobe/deployment-k8s/blob/c1885d713430f193a867e4772b85420d06f82b5e/home-server/session-stamp/stamp.py). It adds **only** a genuine `sp.session.id` attribute to existing spans. It never creates a span, generates a session, or changes trace/span IDs, parent IDs, links, timestamps, resource/scope data, events, status, existing attributes, or captured request/response bodies. Unknown protobuf fields survive parsing/serialization.

## HTTP contract

The process binds **`0.0.0.0:4319` inside Docker**. Publish only **`127.0.0.1:4319:4319`** for the host gateway; OBI uses the private Docker service address on port 4319. Do not expose this demo service publicly.

| Request | Authentication | Result |
| --- | --- | --- |
| `GET /healthz` | None | `200`, `ok\n`; local liveness only, no upstream request |
| `POST /register` | `Authorization: Bearer <token-file-value>` | JSON `{ "traceId": "<32hex>", "sessionId": "<real-session>" }`; `204` on success/idempotent retry |
| `POST /v1/traces` | **`Authorization: Bearer home-demo`** | `application/x-protobuf` OTLP `ExportTraceServiceRequest`; forwards the labeled batch and relays the bounded upstream response |

`home-demo` is the required OBI/staging demo credential, **not** the registration secret. Its scope is this trusted local Docker deployment. The shared HTTP listener is also reachable over the loopback publication; host processes are part of that local trust boundary.

- Registration uses `application/json` (optionally `; charset=utf-8`), without compression. All `Origin` headers on registration are rejected, including an empty or `null` origin. There are **no CORS headers or preflight allowances**.
- Trace requests accept only `application/x-protobuf`; JSON OTLP, gRPC, other signals, and unknown content types are not accepted. `Content-Encoding` may be absent, `identity`, or `gzip`. Gzip must contain exactly one complete member with a valid checksum, without trailing data or concatenated members.
- POST requires a single valid `Content-Length`. Duplicate security/framing headers, transfer/chunked encoding, and `Expect` are rejected. Each connection handles one request and closes.
- Paths are exact: no arbitrary destinations, query strings, alternate paths, or path normalization. Invalid JSON/protobuf/gzip is rejected; a decode failure is **never** silently forwarded.
- Error statuses include `400` malformed input, `401` bad auth, `403` browser registration, `404` unknown path, `405` wrong method, `409` mapping conflict, `411` missing length, `413` oversized input/output, `415` content type/encoding, `417` expectation, `502` transport/redirect/response failure, and `503` registry/worker capacity. Errors do not echo tokens, sessions, paths, or trace bodies.

## Required gateway ordering

Before **each actual application call**:

1. Read the real active agent/tool span's trace ID and the genuine session ID already associated with that request.
2. POST that pair to `http://127.0.0.1:4319/register`, using the separate random registration token. **Await `204` before the application call.** Fail the call/registration step on error rather than pretending it registered.
3. Make the actual application request using its existing real `traceparent`/context and session header. The forwarder does not manufacture parentage or repair propagation.

A trace ID must be exactly 32 hexadecimal characters and nonzero. Uppercase hexadecimal is valid; malformed IDs are not trimmed/repaired. Session IDs must be nonblank printable strings, without surrounding whitespace, at most 256 UTF-8 bytes; their value is preserved exactly.

### Joining and conflict behavior

- The thread-safe, process-local registry holds at most **10,000 trace/session bindings**, with **600-second TTLs** measured by a monotonic clock. Re-registering the same pair refreshes its TTL. Lookups/exports do not keep it alive indefinitely.
- Expired entries are purged on access and during the HTTP server's idle sweep. **Capacity pressure returns `503` instead of evicting an unexpired binding.** This is intentional: forgetting a live binding would weaken conflict protection and cause out-of-order batches to lose labels.
- An unexpired trace cannot be rebound to a different session (`409`). Conflicting explicit span/header labels also reject the entire batch; existing attributes are never overwritten. Conflict validation/cache updates are atomic across the batch.
- Without pre-registration, the only fallback sources are span-level **exact** `sp.session.id` string attributes or captured `x-sp-session-id` / `http.request.header.x-sp-session-id` attributes. Header spelling is case-insensitive and `_` is accepted in place of `-`, including `http.request.header.x_sp_session_id`. Header values may be strings, UTF-8 bytes, or a nonempty flat array of those values; differing values for one trace are a conflict.
- The whole batch is inspected before stamping, so a header on a later span can label earlier siblings/descendants and populate the cache. Resource attributes, arbitrary suffix matches, and unrelated metadata do not supply sessions.
- Unrelated traces without a real mapping/explicit source remain untouched. There is **no body queue, retroactive repair, disk trace cache, or replay**. Registration must precede the call to cover descendant-only batches that arrive before the incoming HTTP span. Restart loses in-memory bindings; calls after restart must register again.
- Valid payloads are preserved semantically, not necessarily byte-for-byte when protobuf is reserialized. Output is uncompressed protobuf with fresh HTTP framing, not a modified body behind a stale gzip header.

## Bounds and upstream

- Encoded OTLP request: **8,000,000 bytes (8 MB)** maximum.
- Decompressed OTLP request: **8,000,000 bytes (8 MB)** maximum, enforced while decompressing.
- Stamped OTLP output: **8,000,000 bytes (8 MB)** maximum.
- Registration request: **4 KiB** maximum; token file: **32–256 bearer-token bytes**, optionally one final LF or CRLF.
- Upstream response: **1 MiB** maximum.
- At most **16 request workers**, plus a bounded listen backlog of 32; excess connections receive `503`.
- Client socket I/O timeout: **10 seconds**. An absolute **30-second client-connection watchdog** also cuts off slow headers/bodies. Upstream urllib socket timeout: **10 seconds**. As with standard urllib, OS DNS resolution is OS-controlled; closing a timed-out client does not claim to cancel an already in-flight upstream operation.
- No request/access/body logging; only generic startup/failure messages. Neither request bodies nor registry contents are persisted.

The sole upstream is **`https://explorer-staging.softprobe.ai/api/thelake/v1/traces`**, always POST with the workspace agent key loaded at startup from **`/run/softprobe.json`** (mounted from `.runtime/softprobe.json`). The file must specify that staging gateway and `environment: staging`. The local `Bearer home-demo` credential is never forwarded upstream. There is no environment/request override. The transport uses Python's default TLS certificate/hostname verification, disables environment proxies, refuses all redirects, and performs no automatic retries. Only bounded response bodies/status and a safe content type return to the exporter; upstream redirect/cookie headers are not relayed.

## Build and start assumptions

From the `TravelAgentDemo` project root, the build command is:

```sh
docker build -t travelagent-session-forwarder ./tracing-forwarder
```

The Dockerfile uses `python:3.12-slim`, installs the pinned packages, runs `python forwarder.py`, and includes a local-only `/healthz` check. The parent subsequently built and ran this container and verified application/airline spans under the real diagnostic Session in staging; see `../verification/trace-preflight.json`. The explicit `SoftprobeTravelDemo/0.1` User-Agent is required by the observed staging edge configuration; the default urllib signature returned Cloudflare 1010.

Integration responsibilities:

- Use `./tracing-forwarder` as the build context, not the repository root. The deny-by-default `.dockerignore` includes only the Dockerfile, requirements, and implementation.
- Generate the registration secret outside the image and mount `.runtime/forwarder-token` read-only at **`/run/forwarder-token`**. It is loaded once at startup; rotate it by restarting the service. Startup fails closed if it is missing, unreadable, or malformed.
- The image defaults to **UID/GID `65532:65532`**. The mounted file must be readable by that UID/GID, **or override the service's numeric user to the token owner's UID/GID**. Do not make the host secret world-readable just to fix the mount. This matters for a mode-0600 bind-mounted host file.
- Publish only **`127.0.0.1:4319:4319`**; attach OBI and the forwarder to the intended private Docker network. The agent uses the host loopback port for registration; OBI exports protobuf to the forwarder's Docker service name, `/v1/traces`, port 4319, with `Bearer home-demo`.
- Exclude the forwarder from OBI instrumentation/target selection to prevent tracing its own OTLP exports and creating an export loop. Select only the intended application processes/ports.
- The image needs no writable application filesystem, elevated capabilities, host networking, or Docker socket. A read-only root filesystem, dropped capabilities, and `no-new-privileges` are compatible.

## Dependencies and offline tests

Versions were read from public PyPI metadata, not guessed:

- [`opentelemetry-proto==1.45.2`](https://pypi.org/pypi/opentelemetry-proto/1.45.2/json), Python >=3.10, requires `protobuf>=5.0,<8.0`.
- [`protobuf==7.36.2`](https://pypi.org/pypi/protobuf/7.36.2/json), Python >=3.10, with macOS and Linux wheels available.

The local test environment is **`.runtime/forwarder-test-env`**, Python **3.12.11**. Tests use stdlib `unittest`; there are no test-only dependency requirements. For a fresh environment, resolve a symlinked Python launcher before creating the venv (a uv-managed macOS launcher otherwise produced an incorrect venv `home`):

```sh
mkdir -p .runtime/forwarder-test-env/tmp
TMPDIR="$PWD/.runtime/forwarder-test-env/tmp" python3.12 -c 'import os,subprocess,sys; subprocess.run([os.path.realpath(sys.executable), "-m", "venv", ".runtime/forwarder-test-env"], check=True)'
TMPDIR="$PWD/.runtime/forwarder-test-env/tmp" PIP_CONFIG_FILE=/dev/null .runtime/forwarder-test-env/bin/python -m pip install --no-cache-dir --disable-pip-version-check --index-url https://pypi.org/simple -r tracing-forwarder/requirements.txt
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tracing-forwarder .runtime/forwarder-test-env/bin/python -m unittest discover -s tracing-forwarder/tests -v
.runtime/forwarder-test-env/bin/python -m pip check
```

Tests exercise real protobuf/gzip, concurrency/expiry/capacity, authentication, strict framing/JSON, parent/attribute/body/unknown-field preservation, and actual loopback HTTP. All export callbacks are in memory; urllib transport tests replace its opener. **No model calls or live trace submissions occur.** The primary OTLP ID/parent contract is the [official trace protobuf schema](https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/trace/v1/trace.proto).
