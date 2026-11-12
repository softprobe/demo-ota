# demo-ota

Plain **travel-ota** and Vercel AI travel-agent demo apps. The published image
contains no Softprobe or Arex SDK, agent, recording, capture, credentials, or
instrumentation configuration.

The OTA calls the hosted NDC 21.3 airline API at
[spair.softprobe.ai](https://spair.softprobe.ai) ([API docs](https://spair.softprobe.ai/docs)).

## Modules

| Module | Role |
|--------|------|
| `travel-ota` | Spring Boot OTA layer |
| [`travel-agent-demo`](travel-agent-demo/README.md) | Vercel AI travel agent packaged into the existing all-in-one demo image |

## Travel agent demo

The `travel-agent-demo` module adds a browser-based travel agent to the demo image. One container runs the Java OTA app and the Node gateway; the gateway serves the agent at `/agent` and proxies the original OTA site at `/`. The OTA defaults to the hosted airline service; no airline-service container is started. Fares over $1,000 USD require manager approval, and payment uses a separate confirmation with the OTA test card. See the [module README](travel-agent-demo/README.md) for running the image.

## Build

```bash
mvn -B -DskipTests package
```

JAR: `travel-ota/target/travel-ota-1.0-SNAPSHOT.jar`

Build the all-in-one image from the repository root:

```bash
docker build -f travel-ota/Dockerfile -t demo-ota:local .
```

The build includes the Java OTA and Node agent in one image. See the [travel agent README](travel-agent-demo/README.md) for `docker run` instructions.

## Release

Push a version tag to run `.github/workflows/release.yml`:

```bash
git tag v1.3.2
git push origin v1.3.2
```

The workflow publishes `docker.io/softprobe/demo-ota:<tag>` and `:latest` for `linux/amd64` and `linux/arm64`. It also creates a GitHub Release with `travel-ota.jar`.

The workflow uses the organization variable `DOCKER_HUB_USERNAME` and secret `DOCKERHUB_TOKEN` to log in to Docker Hub.

## Configuration

```bash
export AIRLINE_NDC_BASE_URL=https://spair.softprobe.ai/ndc/v21.3   # default
```

All NDC operations use Spring's standard `RestTemplate` client.
