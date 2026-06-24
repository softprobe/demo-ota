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

## Outbound HTTP clients (NDC call routing)

Each NDC upstream call uses a **different** HTTP library so workspace E2E exercises all agent `HttpClient` instrumentations.

| OTA API | NDC path | HTTP client |
|---------|----------|-------------|
| `POST /api/flights/search` | `/airshopping` | Spring RestTemplate |
| `POST /api/flights/book` | `/offerprice` | Apache HttpClient 4 (sync) |
| | `/ordercreate` | OkHttp 3 |
| `POST /api/flights/payandissue` | `/orderchange` | OpenFeign |
| `POST /api/flights/orders/query` | `/orderretrieve` | Spring WebClient |
| `POST /api/flights/refund/process` | `/ordercancel` | Ning async-http-client |
| `POST /api/flights/change` | `/airshopping` (optional) | JDK `HttpURLConnection` |
| | `/orderchange` | Apache HttpClient 3 |
| `POST /api/flights/baggage/purchase` | `/servicelist` | OkHttp 3 |
| | `/orderchange` | Apache HttpClient 4 (async) |

Routing is implemented in `org.example.ndc.http.NdcHttpRouter`.
