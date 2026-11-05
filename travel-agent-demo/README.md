# Softprobe travel agent demo

A local browser chat backed by **OpenCode 1.18.30**, using Bill’s real mock travel services and Softprobe **staging**. This is a runnable integration, not a replacement travel application. All inventory and bookings are synthetic; **no payment or ticket issuance is supported**.

## Start

Prerequisites: Node 22+, npm, OpenCode 1.18.30 with an existing OpenAI API connection, and a running Docker Desktop engine. Your global OpenCode production configuration is not edited. The demo uses an isolated process configuration and the existing provider credential store.

Telemetry credentials live in the git-ignored `.runtime/softprobe.json` (mode `0600`). Set `publicKey` to an agent API key from the workspace you will view, `baseUrl` to `https://explorer-staging.softprobe.ai/api/thelake`, `otlpEndpoint` to that URL plus `/v1/traces`, and `environment` to `staging`. The agent reads this file at startup; Docker mounts the same file into the forwarder. Restart the demo's OpenCode process and recreate the forwarder after changing credentials. Existing traces remain in their original workspace.

```sh
cd travel-agent-demo
npm ci --ignore-scripts
npm run demo
```

Open **http://127.0.0.1:4310**. Starting the server does not send a model prompt. The model is `openai/gpt-4.1-mini`. At Onur’s request, interactive chats have **no turn-count or conversation-count test caps**. Startup explicitly selects `maxConversations: null`; saved history and usage counts are retained. A pre-provider hook still enforces **35 model preparations per user turn** and at most **1,024 output tokens per generation**. Booking approval, concurrency/abort checks, and request-size safeguards remain. Removing interactive caps is not permission for open-ended automated model tests; those still require separate approval.

`npm run demo` prepares only generated local staging assets, starts/reuses the Docker stack, waits for health, and launches the chat gateway plus its private OpenCode server. If Docker is already running and the containers are healthy, `npm start` starts just the chat runtime.

## Demonstrate

1. Enter a request: “Find one-way economy flights from LHR to CDG on [an upcoming date]. Prepare the cheapest option for the synthetic traveler Alex Demo.”
2. Review the actual flight, price, date and synthetic traveler. The review shows the **Company Travel Policy**: flights costing **more than $600 USD** require separate manager approval; traveler confirmation is not manager approval.
3. **Normal path:** click **Confirm demo booking**. An above-$600 USD fare stops at **Awaiting manager approval** without creating a reservation or dispatching another model call. The demo has no real manager inbox. USD fares at or below $600 retain the normal verified booking flow; non-USD fares are blocked rather than converted.
4. **Injected path:** for an above-$600 USD fare, click **Inject silent bug**. Read the explanation, then click **Enable silent bug**. This only arms the scenario; it does not book. Click **Confirm demo booking** to execute the controlled skipped-manager-approval simulation. You can also enable it after the normal path has stopped for approval.
5. The agent books the **same selected flight and fare**, and independently queries the returned reference. Only manager approval is bypassed. A verified reservation remains **unpaid / payment pending**; no ticket is issued.
6. Click **Open in Softprobe**. With the optional local read-only adapter configured below, captured evidence produces a Finding such as **“$750 flight booked without required manager approval.”** The policy, explicit approval state, matching tool result and actual HTTP booking response are linked. Missing/uncertain capture produces no Finding; allow for ingest delay.

The policy applies before execution and is documented in [`references/company-travel-policy.md`](references/company-travel-policy.md). The injected bug is not a new policy and does not silently replace the selected flight. New conversations/reviews do not inherit an armed UI toggle. Historical bookings are not retroactively assigned the new policy.

### Optional local Explorer adapter

The local adapter is **read-only and scenario-specific**, not the general QA engine or a production auth gateway. It never synthesizes missing spans, IDs, timings, token usage or cost. It rejects Finding creation/review/dismissal and other mutations; the separate public Explorer UI still needs read-only controls (see the implementation stories).

1. Build the existing `softprobe/sp-llm` `feat/public-demo-session-view` Explorer client using that revision's frozen lockfile.
2. Copy the **contents** of `apps/explorer/dist/client/` to this project's git-ignored `.runtime/explorer-client/`. Do not point a running service at a temporary Hermes cache directory.
3. Create a private, git-ignored `.runtime/explorer-demo.json` (mode `0600`) with `thelakeOrigin` (the staged read API origin), `apiKey` (a server-side read credential for the demo workspace) and `workspaceId` (that exact workspace). Never commit the credential or serve this file to the browser.
4. Restart the chat runtime. When both the config and client build are present, `npm start` opens the loopback-only adapter at `http://127.0.0.1:4320` and uses it for **Open in Softprobe**. Without them, or when `EXPLORER_BASE_URL` is explicitly configured, the existing remote Explorer URL is used. The standalone remote Explorer will not run this local demo adapter automatically.

Keep telemetry and read credentials scoped to the same staging workspace. Findings are built only from actual captured Sessions known to the local gateway, not from the injected checkbox or a fabricated ledger-only result.

The first version supports **one adult, one-way economy**, one booking per conversation. Names are limited to ten ASCII characters each because the upstream mock truncates them. The adapter inserts explicitly synthetic document/contact fields (`DEMO…`, an example.com address, and a reserved example phone number). Do not enter real passport, payment, birth-date, or contact data: full tool/message payloads are captured by Softprobe.

## What is connected

```text
Browser chat :4310
  → private OpenCode server :4311 → dedicated travel agent
  → allowlisted custom travel tools → validated local gateway
  → sp-ota :8080 → sp-airline :8081 (Docker-internal)

OpenCode plugin (native-fetch OTLP transport) ─┐
OBI HTTP capture ────────────────────────────┴→ local Session forwarder :4319 → staging
```

The project tracing plugin reuses the installed Softprobe plugin’s public hooks/tracer implementation. A small client subclass captures the **actual** tool span context. It does not fabricate trace IDs or create duplicate stock-plugin spans. Tools transmit the actual W3C trace parent and OpenCode session ID. The gateway pre-registers that genuine mapping with the Session forwarder before any application call; failures stop the operation rather than silently losing correlation. The forwarder adds only `sp.session.id`, preserving trace/span/parent IDs. Its internal port is also 4319, outside OBI’s application-port selection, to prevent export loops.

The chat page loads the official **`@softprobe/web`** browser bundle before `app.js`. It records rrweb batches and injects `x-sp-session-id` into same-origin fetch/XHR calls. Restored conversations seed the SDK before it starts; creating a conversation waits for `setSessionId()` before sending the first message. New conversations rotate the browser session, and page restores resume recording. Browser recordings use `/api/telemetry/v1/traces`, a same-origin gateway that forwards them with the workspace key from `.runtime/softprobe.json` and the `staging` environment. The workspace key is not embedded in the page. The pinned GitHub package build is documented in `vendor/README.md`.

The default Node-http exporter was observed to time out under this OpenCode/Bun build after ingest, then redeliver identical spans. The local wrapper now uses the standard OTLP protobuf serializer with native `fetch` through the SDK’s public exporter interface. Ambiguous export failures are surfaced, not automatically retried. The successful live Session has no duplicate trace/span IDs.

OpenCode has deny-all permissions except `travel_search`, `travel_prepare`, `travel_book`, and `travel_order`. It cannot use the shell, browse the web, edit/read files, dispatch subagents, or approve its own booking.

## Boundaries and safety

- All published ports bind to **127.0.0.1**. Do not expose this demo to the internet.
- The browser does not receive OpenCode credentials or internal capability tokens. Runtime files are ignored by git and private capabilities are stored with restricted permissions.
- Booking approval is tied to the exact session/offer/traveler, expires after fifteen minutes, and is persisted before a mutation. Duplicate submissions do not make another booking.
- An interrupted/uncertain booking is **not retried**. A known reference can be independently rechecked. Without one, the UI must report uncertainty rather than invent success.
- The mock can return `CONFIRMED` for invalid IDs. The adapter checks flight identity, times, traveler, amount, currency and payment state, then queries the actual order. A mismatched response is not treated as success.
- Hosted telemetry uses the workspace agent key from `.runtime/softprobe.json` through the staging Explorer gateway. `home-demo` is only the local exporter/OBI-to-forwarder credential; the forwarder replaces it with the workspace key for hosted requests. Use synthetic data only.
- OBI requires a privileged container and host PID access inside Docker’s Linux VM. It is scoped to the local Docker demo. The upstream recipe’s context-propagation warning has been investigated using actual trace ancestry, not hidden or ignored.

## Stop / restart

Stop the chat with **Ctrl+C** in its terminal. The Docker travel services intentionally remain running so their in-memory orders are not destroyed.

To stop the containers explicitly:

```sh
/Applications/Docker.app/Contents/Resources/bin/docker compose stop
```

**Stopping/restarting the airline service loses its mock inventory/orders.** Saved local conversations and evidence do not recreate them. Use a new search after a restart; do not reuse stale offers. No automatic reset, order deletion, or usage-limit reset is provided.

## Tests and verification

```sh
npm test
npm run check
```

The Node suite covers approval isolation, expiry, concurrent submission, process-crash recovery, persistence failures, returned-order validation, browser-origin checks, model-use limits, configuration isolation, real span-context propagation, and fail-closed trace registration. The Session forwarder has its own offline tests; see `tracing-forwarder/`.

### Repository relocation verification

The relocated application passes **230 Node tests** and **26 forwarder tests**, plus syntax checks. Runtime code, tests, dependencies, pinned upstream snapshots and the vendored SDK are unchanged from `deployment-k8s` commit `83153068add5d7ed1b984aed4fc26179afc1062b`; only repository documentation and CI paths were adapted. See [`MIGRATION.md`](MIGRATION.md).

### Historical integration evidence

The following records describe earlier verification, not new model calls performed during the repository move. Their `verification/` files belong to the original local runtime and are not included in this source-only checkout.

**Verified live:** the browser conversation searched, prepared a review, required a button confirmation, created an unpaid mock reservation, and independently queried it. The recorded reservation is **V5NAKA** / **BK1793312852226**, synthetic traveler Alex Demo, Air France AF147, LHR → CDG on 2026-11-05, USD 770. This is not a real ticket and will disappear if the mock airline restarts.

The [Softprobe Session](https://explorer-staging.softprobe.ai/?productSession=ses_e763a08daffeQGeO00qTTJ6HgW&view=e2e) was read back through the staging API: **25 unique spans, five model generations, three travel tools**, and verified tool → application → airline parent chains. The browser was exercised live, then checked at 1280×900 and 390×844 with no horizontal overflow or captured console exceptions. **That historical run passed 66 Node tests.** Evidence and scripts are under `verification/` and `scripts/verify-live.mjs`.

**Known boundaries:** the staging web UI requires the user’s sign-in; no saved login was available, so authenticated UI access was not claimed. OBI additionally emits four airline HTTP spans whose parents are absent from this Session response; the primary connected paths are verified, and those extra spans were preserved rather than given invented parents. Details are in `verification/live-success.json`.

The initial verification included an expired-key HTTP 401 with zero reported tokens and no travel tools, followed by a successful run after the credential update. Interactive test caps have since been removed at the user’s request. The limit-removal change was verified with offline engine fixtures and a read-only runtime health check, with no new model calls. Zero-model transport diagnostics are separately labeled and do not claim successful agent actions.

## Upstream sources

- Deployment: `softprobe/deployment-k8s@c1885d713430f193a867e4772b85420d06f82b5e`, supplied branch `019-explorer-e2e-graph`; snapshots in `upstream/`.
- Docker app/airline: `softprobe/sp-ota:v2.0.3` and `softprobe/sp-airline:v2.0.3`, multiarch. Matching source found via image provenance: `softprobe/demo-air@c21fe8de7ef161b02b5779bee06548ca284351bd`.
- This repository's existing Java/NDC `travel-ota` module is **not** the pinned service run by this agent-demo Docker recipe; moving the source here does not change the verified backend contract.
- A durable extracted API contract and provenance are in `references/contract.json` and `references/CONTRACT.md`.

## Dependency note

Compatible overrides removed the initial high-severity dependency findings. The remaining npm audit findings are moderate, inherited from OpenTelemetry core 1.30.1’s W3C baggage-allocation advisory. This demo uses explicit W3C **trace-context injection**, not baggage extraction, and private providers without global registration. A blanket OpenTelemetry major-version override was deliberately avoided because it would break the Softprobe SDK’s compatibility assumptions. This local demo is not a production security clearance.
