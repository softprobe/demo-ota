# Demo Airline OTA

This repo contains a minimal, clean demo OTA system with three components:

1) Web app (static UI bundled in the OTA service)
2) OTA layer (Spring Boot service)
3) Fake airline service (Spring Boot service)

## Project layout

- airline-common: Shared models and DTOs
- travel-ota: OTA service + static web UI (port 8080)
- sp-airline: Fake airline service (port 8081)

## Prerequisites

- Java 21
- Maven 3.9+

## Build

From the repo root:

```bash
mvn package
```

## Run

Terminal 1:

```bash
cd sp-airline
./run.sh
```

Terminal 2:

```bash
cd travel-ota
./run.sh
```

Then open http://localhost:8080/

## Releases (for `sp demo start`)

Pre-built JARs are published on [GitHub Releases](https://github.com/softprobe/demo-ota/releases):

- `sp-airline.jar` — fake airline service
- `travel-ota.jar` — instrumented OTA app + static UI

To cut a release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The `release` workflow builds both modules and attaches the JARs to the release.

## Notes

- The web UI is served from travel-ota at `/` and uses the OTA API under `/api`.
- The OTA service calls the fake airline service on port 8081.
