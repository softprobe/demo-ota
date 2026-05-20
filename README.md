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

## Notes

- The web UI is served from travel-ota at `/` and uses the OTA API under `/api`.
- The OTA service calls the fake airline service on port 8081.
