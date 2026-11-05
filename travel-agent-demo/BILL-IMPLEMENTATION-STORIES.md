# Public Interactive Travel Agent Demo: Agile User Stories for Bill

This PR checks in the **OpenCode Travel Agent Demo** (`travel-agent-demo/`) against Softprobe staging (`softprobe/sp-ota:v2.0.3`, `softprobe/sp-airline:v2.0.3`, OpenCode `1.18.30`, `@softprobe/web`, `@softprobe/opencode-plugin`, and OBI HTTP capture). The primary silent-bug scenario is now **a flight above $600 USD booked without required manager approval**, replacing flight/fare switching. The repository includes the policy gate, simulation popup, captured approval evidence and an optional local read-only, scenario-specific Finding adapter. Public hosting/auth work below remains separate.

Below are the user stories and acceptance criteria for turning this local demo into a **public, zero-login interactive demo** where anyone can talk to the AI travel agent and immediately inspect their own live session in Softprobe Explorer.

---

## Story 1: Host the Travel Agent Demo with Multi-Visitor Rate Limits & Starter Prompts

- **Role:** As a prospective technical buyer or developer visiting Softprobe's interactive demo
- **Want:** I want to chat with the live OpenCode travel agent (or click a starter prompt), confirm a synthetic flight reservation, and have my browser rrweb recording, OpenCode LLM/tool spans, and `sp-ota` / `sp-airline` OBI HTTP spans correlated under one `sp.session.id`
- **So that:** I can experience a real multi-service AI agent workflow and immediately inspect my own live session in Softprobe Explorer without exhausting the shared OpenAI budget.

### Acceptance Criteria (Gherkin)

```gherkin
Scenario: Public origin and reverse-proxy support
  Given the Travel Agent Demo is deployed behind a public HTTPS origin (for example, "https://travel-demo.softprobe.ai")
  When a visitor loads the page and sends browser requests from that origin
  Then "src/security.mjs" and "src/server.mjs" accept the configured public origin alongside localhost
  And "@softprobe/web" posts browser recording spans to the same-origin "/api/telemetry/v1/traces" proxy over HTTPS

Scenario: Per-session and per-IP rate limits protect the OpenAI budget
  Given the gateway is configured with per-session turn limits (e.g., 6-8 turns per session) and per-IP hourly session limits (e.g., 5-10 sessions/hour)
  When a single session exceeds the turn cap or a single IP exceeds the hourly session cap
  Then the gateway returns HTTP 429 with a plain-English message directing the visitor to inspect their existing session in Softprobe
  And no additional OpenCode / OpenAI model calls are dispatched

Scenario: Clickable starter prompts in the empty state
  Given a visitor opens the Travel Agent UI before sending a message
  When they click one of the starter prompt pills in "#empty-state" (using the existing ".prompt-suggestions" / ".prompt-button" styles in "public/styles.css")
  Then the browser creates a session ("ses_..."), syncs the "@softprobe/web" session ID, and submits the prompt with the current default date
```

---

## Story 2: Zero-Login Read-Only Demo Session View in Softprobe Explorer (`softprobe/sp-llm`)

- **Role:** As an unauthenticated visitor who just clicked **Open in Softprobe** from the Travel Agent Demo
- **Want:** I want `explorer-staging.softprobe.ai/?productSession=ses_...&view=e2e&demo=1` (or production Explorer) to open directly into `ProductSessionDetailView` (Graph, Trajectory, Replay, Evidence, Trace) without hitting the Signup screen
- **So that:** I can inspect my own live E2E HTTP call graph, OpenCode trajectory, and rrweb browser replay immediately without creating an account first.

### Acceptance Criteria (Gherkin)

```gherkin
Scenario: Unauthenticated visitor opens a demo session link from the Travel Agent app
  Given the visitor is not signed into Softprobe Explorer
  When they click "Open in Softprobe" ("/?productSession=ses_...&view=e2e&demo=1")
  Then "App.tsx" bypasses the "shell = 'signup'" redirect and renders "ProductSessionDetailView" in read-only demo mode on the "Graph" ("e2e") tab
  And the visitor can switch between "Graph" ("e2e"), "Trajectory", "Replay" (rrweb), "Evidence", and "Trace" for that session
  And a top banner indicates read-only demo mode with a "Sign up to connect your agent" CTA

Scenario: Explorer Worker restricts demo requests to read-only queries on the demo workspace
  Given a request arrives at the Explorer Worker with header "X-Softprobe-Demo: 1" and no user session JWT
  When the request is a read-only query ("GET /api/thelake/v1/llm/...", "POST /api/thelake/v1/llm/sessions/search", "POST /api/thelake/v1/llm/spans/search", or "GET /api/ops/findings")
  Then "apiGateway.ts" mints a Softprobe assertion scoped strictly to the dedicated Travel Demo workspace ("DEMO_WORKSPACE_ID" / "DEMO_AGENT_API_KEY")
  When the request is any mutation ("POST /api/ops/...", "PUT", "PATCH", "DELETE")
  Then the Worker rejects the request with HTTP 403 ("Demo mode is read-only")
```

---

## Story 3: Make the silent business-policy failure understandable

- **Role:** As a prospective customer trying the travel demo
- **Want:** I want to see a successful booking that nevertheless violates a plain-English company rule
- **So that:** I understand that technical success does not establish correct agent behavior.

### Acceptance Criteria (Gherkin)

```gherkin
Scenario: The company policy applies before booking
  Given a prepared USD fare costs more than $600
  Then its review states that separate manager approval is required
  And the traveler's confirmation does not count as manager approval
  When the traveler confirms without enabling the silent bug
  Then manager approval is pending and no reservation is created
  And no additional model request is dispatched for that confirmation

Scenario: Explain the injected failure before enabling it
  When the visitor clicks "Inject silent bug"
  Then an accessible dialog explains the company rule and skipped-manager-approval simulation
  And it states that no real payment or ticket is involved
  When the visitor cancels or presses Escape
  Then the simulation remains disabled and focus returns to its trigger
  When the visitor clicks "Enable silent bug"
  Then the simulation is armed for this request only, without creating a booking

Scenario: Execute the controlled silent failure
  Given the visitor enabled the simulation for a fare above $600 USD
  When they confirm the exact prepared booking
  Then only the manager-approval gate is bypassed
  And the same flight, fare and synthetic traveler are booked
  And independent order read-back must still verify the result
  And the tool result records the actual explicit manager-approval state
  And the reservation remains unpaid and not ticketed

Scenario: Explain the violation using captured evidence
  Given the policy-bearing preparation, matching verified booking tool result and related successful booking HTTP response have been captured
  When the local demo adapter evaluates the Session
  Then it returns a Finding such as "$750 flight booked without required manager approval"
  And evidence links reference the captured preparation, booking tool and booking HTTP spans
  And its provenance is the scenario-specific deterministic demo adapter, not the general QA engine
  Given those captured facts are absent, mismatched or uncertain
  Then it returns no fabricated Finding or reconstructed telemetry

Scenario: Protect boundary and unrelated requests
  Given a USD fare costs $600 or less
  Then this additional manager-approval rule is not required and the simulation cannot be enabled
  Given a non-USD fare
  Then booking is blocked instead of inventing a currency conversion
  When a new session or prepared request replaces the old review
  Then it does not inherit an armed simulation
```

## Out-of-Scope Firewall

1. **No public shell/file/web tool access in OpenCode:** OpenCode permissions remain locked to `{"*": "deny", "travel_*": "allow"}` with `ModelBudget({ maxCalls: 35 })` (`steps: 35`) per user turn.
2. **No anonymous mutations in Explorer:** Unauthenticated `?demo=1` visitors cannot create workspaces, edit policies, publish findings, or trigger Slack alerts.
3. **No real payments or PII:** All bookings remain unpaid (`paymentStatus: PENDING`) using synthetic traveler fields (`Alex Demo`, `DEMO000001`).
