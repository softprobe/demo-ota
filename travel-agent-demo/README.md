# demo-ota travel agent

A browser chat for flight search, booking, payment, and order verification, built with the Vercel AI SDK. The existing demo image contains both the Java OTA and the Node agent gateway in one container. The original OTA stays at `/`; the agent is served at `/agent` on the same origin.

The OTA calls the deployed Cloudflare airline service at `https://spair.softprobe.ai/ndc/v21.3`. The demo does not run an airline-service container.

## Run the image

Requirements: Docker and an API key for at least one model provider. API keys stay in the container environment and are never sent to the browser. The model selector lists configured providers; enter a model ID supported by the selected provider.

```sh
DEMO_IMAGE=docker.io/softprobe/demo-ota:v1.3.0
docker pull "$DEMO_IMAGE"
docker run --rm --init \
  --publish 127.0.0.1:8080:8080 \
  --env GOOGLE_GENERATIVE_AI_API_KEY \
  "$DEMO_IMAGE"
```

Open [http://127.0.0.1:8080/](http://127.0.0.1:8080/) for the original OTA web app or [http://127.0.0.1:8080/agent](http://127.0.0.1:8080/agent) for the agent. The single container starts the Java OTA on an internal port and exposes the Node gateway on port 8080; the gateway proxies the original OTA site and APIs.

To run a locally built image, build from the repository root with `docker build -f travel-ota/Dockerfile -t demo-ota:local .`, then use `DEMO_IMAGE=demo-ota:local npm run demo` from this directory. `npm run demo` runs that one image with `docker run`; it does not start Compose services. The image is a plain application and contains no Softprobe instrumentation.

Provider environment variables:

- `GOOGLE_GENERATIVE_AI_API_KEY` for Gemini.
- `OPENAI_API_KEY` for OpenAI.
- `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` for Anthropic.
- `AI_GATEWAY_API_KEY` (or Vercel's `VERCEL_OIDC_TOKEN`) for Vercel AI Gateway model IDs in `provider/model` form.
- `AI_COMPATIBLE_BASE_URL` and optionally `AI_COMPATIBLE_API_KEY` for an OpenAI-compatible endpoint.

You can set `TRAVEL_PROVIDER` and `TRAVEL_MODEL` to choose the initial selection. The browser can change the provider and model for each new conversation. No provider key is stored in browser storage.

## Try the agent

1. Ask for one-way economy flights from LHR to CDG on an upcoming date. Use a synthetic name such as Alex Demo.
2. Review the returned flight, fare, date, and traveler in the trip panel. The agent supports one adult and one-way economy.
3. Click **Confirm booking** to continue. Fares above $1,000 USD stop for separate manager approval. Traveler confirmation is not manager approval. Non-USD fares are blocked because the policy is denominated in USD.
4. To see the controlled failure scenario, explicitly enable **Inject silent bug**, read its confirmation dialog, then confirm the same synthetic booking. This simulation skips only the manager-approval gate for that request.
5. The app verifies a completed reservation against an independent order lookup. The traveler can separately click **Pay and issue ticket**; the gateway uses the OTA’s documented test card and verifies the paid order before showing success.

The booking and payment APIs use synthetic traveler data and a fixed test card. Do not enter real personal or payment information. This app does not collect card details. It does not refund, change, or book multiple passengers.

## Development

```sh
npm run check
npm test
```

The offline tests use fixtures and do not call the model or airline service. To run only the agent runtime from source during development, use `npm start`; it expects the OTA API at `http://127.0.0.1:8080` by default. The all-in-one image is the supported standalone demo and E2E app entrypoint.
