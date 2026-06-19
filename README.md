# demo-ota

Instrumented **travel-ota** demo app for Softprobe record/replay E2E.

Upstream airline mock (NDC 21.3 JSON): **[sp-airline-ndc](https://github.com/softprobe/sp-airline-ndc)** — hosted at [spair.softprobe.ai](https://spair.softprobe.ai) ([API docs](https://spair.softprobe.ai/docs)).

## Modules

| Module | Role |
|--------|------|
| `travel-ota` | Spring Boot OTA layer (Java agent instrumented) |

## Build

```bash
mvn -B -DskipTests package
```

JAR: `travel-ota/target/travel-ota-1.0-SNAPSHOT.jar`

## Configuration

```bash
export AIRLINE_NDC_BASE_URL=https://spair.softprobe.ai/ndc/v21.3   # default
```
