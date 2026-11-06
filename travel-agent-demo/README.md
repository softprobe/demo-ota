# demo-ota travel agent

A local browser chat for synthetic flight search and booking, built with OpenCode 1.18.30. It runs beside this repository’s original OTA web app: the original stays at `/`, and the agent is served at `/agent` on the same local origin. Reservations remain unpaid and no ticket is issued.

## Start

Requirements: Node.js 22+, npm, Docker, and OpenCode 1.18.30 configured with a model provider. The agent process uses an isolated OpenCode config and keeps the existing local authentication store.

```sh
cd travel-agent-demo
npm ci --ignore-scripts
npm run demo
```

Open [http://127.0.0.1:4310/](http://127.0.0.1:4310/) for the original OTA web app or [http://127.0.0.1:4310/agent](http://127.0.0.1:4310/agent) for the agent. `npm run demo` starts the synthetic OTA and airline services in Docker, then launches the local agent gateway and OpenCode server. The app binds to loopback only.

## Try the agent

1. Ask for one-way economy flights from LHR to CDG on an upcoming date. Use a synthetic name such as Alex Demo.
2. Review the returned flight, fare, date, and traveler in the trip panel. The agent supports one adult and one-way economy.
3. Click **Confirm demo booking** to continue. Fares above $600 USD stop for separate manager approval. Traveler confirmation is not manager approval. Non-USD fares are blocked because the policy is denominated in USD.
4. To see the controlled failure scenario, explicitly enable **Inject silent bug**, read its confirmation dialog, then confirm the same synthetic booking. This simulation skips only the manager-approval gate for that request.
5. The app verifies a completed reservation against an independent order lookup. Payment remains pending; no ticket is issued.

The mock inserts synthetic document and contact fields. Do not enter real personal or payment information. The app cannot pay, issue tickets, refund, change, or book multiple passengers.

## Development

```sh
npm run check
npm test
```

The offline tests use fixtures and do not call the model or Docker services. To start only the agent runtime after the synthetic services are already running, use `npm start`.
