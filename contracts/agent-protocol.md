# Cross-tier wire contracts (`demo-ota` v2)

## 1. Container port and process layout

- **Front-door HTTP (`Nginx`):** `${PORT:-${TRAVEL_AGENT_PORT:-8080}}`
  - `/` -> static `/opt/ota-web` (`apps/ota-web/`)
  - `/agent` and `/agent/*` (static files `/agent`, `/agent/`, `/agent/index.html`, `/agent/app.js`, `/agent/styles.css`) -> static `/opt/chat-web` (`apps/chat-web/`)
  - `/agent/api/*` -> reverse-proxied to `http://127.0.0.1:${AGENT_PORT:-4311}/agent/api/*` (preserving `traceparent`, `tracestate`, `baggage`, `Origin`, `Host`)
  - `/api/*` -> reverse-proxied to `http://127.0.0.1:${OTA_BACKEND_PORT:-8081}/api/*` (preserving `traceparent`, `tracestate`, `baggage`, `arex-*`, `sp-*`)
  - `/__sandbox/*` -> reverse-proxied to `http://127.0.0.1:${PAYMENT_SANDBOX_PORT:-8082}/__sandbox/*`
- **Java Spring Boot (`services/travel-ota`, `/app.jar`):** `127.0.0.1:8081` (`open_ports: "8081"` for `sp-obi` and `*app.jar*` for `obi`)
- **PostgreSQL (`postgres`):** `127.0.0.1:5432/ota` (`SPRING_DATASOURCE_URL=jdbc:postgresql://127.0.0.1:5432/ota`, with embedded H2 PostgreSQL-mode fallback when `SPRING_DATASOURCE_URL` is unset in standalone JAR unit/CLI runs)
- **Go Side-Effect Sandbox (`services/ota-sandbox`):**
  - Payment listener on `127.0.0.1:8082`: `POST /v1/payments/authorize`, `GET /__sandbox/deliveries`, `DELETE /__sandbox/deliveries`, `GET /healthz`
  - Notification listener on `127.0.0.1:8083`: `POST /v1/notifications/confirmation`, `GET /healthz`

## 2. Java booking-session API (`services/travel-ota` on `:8081`)

All stateless AI agent backends (`agents/vercel-ai`, `agents/langgraph-py`, `agents/google-adk-py`) store zero booking files and delegate all domain state to `travel-ota`:

- `GET /api/bookings/sessions/{sessionId}`
  - Returns `{ "sessionId": "ses_...", "offers": [...], "pending": <PendingReview|null>, "booking": <VerifiedBooking|null>, "travelPolicy": <TravelPolicy> }`.
  - Auto-initializes an empty session view if `{sessionId}` has no rows yet.
- `POST /api/bookings/sessions/{sessionId}/tools/search`
  - Body: `{ "origin": "LHR", "destination": "CDG", "date": "2026-12-01" }`
  - Validates 3-letter supported airport codes (`origin != destination`) and valid future `YYYY-MM-DD` date; returns `400 { "error": "..." }` on invalid arguments (supporting Blackbox 400 tool-span contract).
  - Calls `FlightService.searchFlights`, maps up to 6 cheapest `ECONOMY` offers (`id: "{flightId}:{fareId}"`), cancels any unsubmitted `awaiting_approval` or `approved` pending review, persists `offers` in `ota_booking_sessions`, and returns `200 { "offers": [...], "constraints": "One-way economy, one adult. Synthetic inventory; no payment." }`.
- `POST /api/bookings/sessions/{sessionId}/tools/prepare`
  - Body: `{ "offerId": "...", "firstName": "Alex", "lastName": "Demo" }`
  - Validates 1..10 ASCII name rules and matching offer in session; computes `TRV-01` `managerApproval` (`not_required` when `USD` and `total <= 1000`, `not_requested` when `USD` and `total > 1000`, `unsupported_currency` otherwise), persists `pending` (`status: "awaiting_approval"`, `id: "<uuid>"`, `expiresAt`), and returns `200 <PendingReview>`.
- `POST /api/bookings/sessions/{sessionId}/approve`
  - Body: `{ "requestId": "<uuid>", "injectSilentBug": false }`
  - Transitions `pending` to `approved` (setting `managerApproval.status = "pending"` when `> 1000 USD` and `!injectSilentBug`, or attaching `demoFault: { "kind": "skip_manager_approval", "enabledAt": "..." }` when `injectSilentBug == true` on `> 1000 USD`).
  - Returns `200 { "accepted": true, "awaitingManagerApproval": <bool>, "pending": <PendingReview> }`.
- `POST /api/bookings/sessions/{sessionId}/tools/book`
  - Body: `{ "requestId": "<uuid>" }`
  - Enforces `pending.status == "approved"` and (`managerApproval.status == "not_required"` or `demoFault.kind == "skip_manager_approval"`). Calls `FlightService.bookFlight` (which invokes NDC, persists to `ota_orders`, and sends confirmation email to `:8083` unless `OTA_FAULT_SKIP_EMAIL=true`) + `FlightService.queryOrder` verification read-back, updates `pending.status = "completed"` with `verified: true`, and returns `200 <VerifiedBooking>`.
- `POST /api/bookings/sessions/{sessionId}/tools/order`
  - Body: `{}`
  - Calls `FlightService.queryOrder` for the session's booking confirmation number, verifies consistency, and returns `200 <VerifiedBooking>`.
- `POST /api/bookings/sessions/{sessionId}/pay`
  - Body: `{ "requestId": "<uuid>" }`
  - Calls `FlightService.payAndIssue` (which authorizes payment at `:8082`, calls NDC `/orderchange`, records `ota_payments`, and sends confirmation email to `:8083` unless `OTA_FAULT_SKIP_EMAIL=true`) + `FlightService.queryOrder` (`PAID` verification), updates `pending.payment`, and returns `200 { "paid": true, "booking": <VerifiedBooking> }`.
- `POST /api/bookings/sessions/{sessionId}/cancel`
  - Body: `{ "requestId": "<uuid>" }`
  - Cancels unsubmitted review and returns `200 { "cancelled": true, "pending": <PendingReview> }`.

## 3. Agent HTTP API (`agents/<flavor>` on `:4311`, mounted under `/agent/api/*`)

Every agent flavor (`vercel-ai`, `langgraph-py`, `google-adk-py`) exposes the exact same JSON endpoints for `apps/chat-web/`:

- `GET /agent/api/status` -> `{ "ready": boolean, "runtime": boolean, "runtimeFlavor": "vercel-ai"|"langgraph-py"|"google-adk-py", "providers": [...], "defaultProvider": "...", "defaultModel": "...", "model": "...", "travel": boolean, "environment": "local synthetic demo", "defaultDate": "YYYY-MM-DD", "conversationLimit": null, "conversationsUsed": number }`
- `POST /agent/api/sessions` -> `{ "id": "ses_<uuid>", "provider": "...", "model": "..." }` (`201`)
- `GET /agent/api/sessions/{sessionId}` -> `{ "id": "ses_...", "provider": "...", "model": "...", "messages": [...], "busy": boolean, "pending": ..., "offers": [...], "booking": ..., "travelPolicy": ..., "lastError": string|null }` (`200`)
- `POST /agent/api/sessions/{sessionId}/messages` -> `{ "text": "...", "offerId"?: "..." }` -> runs the LLM + tool turn synchronously within the incoming HTTP request span so W3C `traceparent` and `baggage` (`sp.session.id`) wrap all `GENERATION`, `TOOL`, and downstream `travel-ota` HTTP + SQL spans, then returns `200 { "accepted": true, "completed": true }`.
- `POST /agent/api/sessions/{sessionId}/approve` -> `{ "requestId": "<uuid>", "injectSilentBug"?: boolean }` -> calls Java `/approve`; if `!awaitingManagerApproval`, runs the continuation turn (`travel_book` + `travel_order`) synchronously within the request trace and returns `200 { "accepted": true, "awaitingManagerApproval": false }`; otherwise returns `200 { "accepted": true, "awaitingManagerApproval": true }`.
- `POST /agent/api/sessions/{sessionId}/pay` -> `{ "requestId": "<uuid>" }` -> forwards to Java `/pay` with active trace headers and returns `200 { "paid": true, "booking": ... }`.
- `POST /agent/api/sessions/{sessionId}/cancel-booking` -> `{ "requestId": "<uuid>" }` -> forwards to Java `/cancel` and returns `200 { "cancelled": true }`.
- `POST /agent/api/sessions/{sessionId}/abort` -> `{}` -> aborts any active turn and returns `200 { "stopped": true }`.
