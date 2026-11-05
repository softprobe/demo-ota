# Docker sp-ota contract: search → prepare → book → query

## Outcome and provenance

- The pinned deployment `softprobe/deployment-k8s@c1885d713430f193a867e4772b85420d06f82b5e` uses **both `softprobe/sp-ota:v2.0.3` and `softprobe/sp-airline:v2.0.3`**, not airline `v2.0.1`. The files are `home-server/travel-ui-web/{index,booking,orders,payment}.html`; `travel-ui/index.html` is not the pinned path. [Deployment compose][compose]
- Located the matching source repository: **`softprobe/demo-air`**, not `softprobe/demo-ota`. Both current v2.0.3 image attestations identify `https://github.com/softprobe/demo-air`, revision **`c21fe8de7ef161b02b5779bee06548ca284351bd`**, under `predicate.metadata["https://mobyproject.org/buildkit@v1#metadata"].vcs`. Raw manifests/provenance are retained in `registry-evidence/`. This establishes the source linkage; it is not a reproduced build or runtime test. [OTA attestation][ota-provenance] · [Airline attestation][airline-provenance]
- The deployment's `index.html` differs from the matching image-source `index.html` only by adding the Softprobe recording script and indentation. It still loads `/js/sessionManager.js` and `/js/search.js` from the image. The compose mounts HTML and the recording bundle, not the API-client JavaScript. [Deployment HTML][html-scripts] · [Compose][compose]
- **There is no backend prepare/hold endpoint.** Preparation is client-side selection of a returned flight/fare, then collecting passenger/contact data. Do not invent `/prepare`, NDC offers, `offerId`, or `orderId`. [Selection code][prepare] · [Controller][controller]
- All findings below use the image-linked revision, not `demo-air/main`, which has since changed backend routes/persistence. No source from the unrelated Java `demo-ota` implementation was used.

## Network and architecture

| Component | Configured HTTP listener | Access in pinned compose |
|---|---|---|
| `travel-ui` / `sp-ota:v2.0.3` | `8080`, context `/` | Published `8080:8080`; browser/API base `http://localhost:8080` |
| `demo-airline` / `sp-airline:v2.0.3` | `8081`, context `/airline-api` | Internal compose service; **not host-published** |
| OTA → airline | `AIRLINE_BASE_URL=http://demo-airline:8081/airline-api/v1` | JSON HTTP calls, not NDC |

Sources: [compose lines 4–26][compose], [OTA application config][ota-config], [airline application config][airline-config]. Both image configs inspected have no `ExposedPorts` entry; do not infer a different listener from missing EXPOSE metadata.

**Not amd64-only.** Docker Hub metadata and OCI indexes list runnable `linux/amd64` **and `linux/arm64`** for both v2.0.3 images. The older airline v2.0.1 tag also lists both. The additional `unknown/unknown` descriptors are attestation manifests. No platform override appears in the pinned compose. The release workflow explicitly builds both platforms. [OTA tag metadata][ota-tag] · [Airline tag metadata][airline-tag] · [Release workflow][release]

Observed immutable v2.0.3 index digests (not a claim about any already-installed local image):

- OTA: `sha256:171d7c52d6b4f8acf3dafb23c46c4335abc6763ac471ce409c519a2f212e5b92`
- Airline: `sha256:e0a107dfce644626cbbd42d58598130206f8698475df02a6f0a163e3ac2a4b3e`

## HTTP operations and headers

| Step | OTA endpoint | Airline endpoint used internally | Success body |
|---|---|---|---|
| Search | `POST /api/flights/search` | `POST /airline-api/v1/flights/search` | `FlightSearchResponse` |
| Prepare | **No HTTP call** | None | Local `{flight, fare}` selection |
| Book | `POST /api/flights/book` | `POST /airline-api/v1/flights/book` | `BookingResponse` |
| Query confirmation | `POST /api/flights/orders/query` | `POST /airline-api/v1/orders/query` | `BookingResponse` |
| Pay/issue, separate mutation | `POST /api/flights/payandissue` | `POST /airline-api/v1/payment/process` | `PaymentResponse` |

The controller returns HTTP 200 for successful operations. [OTA controller lines 16–105][controller] · [OTA forwarding service][ota-service] · [Airline controller][airline-controller]

- Send **`Content-Type: application/json`**. The supplied search/booking/payment client also sends **`x-sp-session-id`**. Its source-generated shape is `sp-session-<UUID-v4-shaped string>` and it is reused from sessionStorage key `x-sp-session-id`. [Search client][search-client] · [Booking client][booking-client] · [Session manager][sessions]
- `x-sp-session-id` is **trace correlation, not authentication**. No OTA Authorization/API-key header is declared by these client/controller implementations. Do not reuse telemetry-ingest credentials as OTA credentials. `orders.js` sends only Content-Type explicitly; the injected recording script adds the session header for same-origin fetch/XHR. [Order client][orders-client] · [Deployment instrumentation doc][instrumentation]
- The application-level OTA forwarding code creates new headers containing Content-Type; it does not explicitly forward `x-sp-session-id` to the airline. Do not promise end-to-end header propagation without instrumentation/runtime verification. [OTA service lines 41–57, 100–111, 178–191][ota-service]

## Request contract and source-derived synthetic templates

These are **templates, not executed requests or observed responses**. Angle-bracket values must be replaced; never manufacture valid flight/fare/booking IDs. The synthetic passenger values below are from the airline unit test. Use no real passport/payment data for this demo. [Test fixture lines 63–101][fixture]

### 1. Search

```json
{
  "fromCity": "LHR",
  "toCity": "CDG",
  "departureDate": "<YYYY-MM-DD; source test uses today plus 7 days>",
  "tripType": "ONE_WAY",
  "cabinClass": "ECONOMY",
  "passengerInfo": {"adults": 1, "children": 0, "infants": 0}
}
```

Top-level `fromCity`, `toCity`, `tripType`, `cabinClass` are annotated NotBlank; `departureDate` is a required Java LocalDate; `passengerInfo` is required. Documented string choices: trip `ONE_WAY | ROUND_TRIP`; cabin `ECONOMY | PREMIUM_ECONOMY | BUSINESS | FIRST`. Passenger integers default to `1,0,0`, with annotated minima `1,0,0`. The parent object lacks nested `@Valid`, so do not rely on recursive server validation. The browser additionally prevents infants exceeding adults. [Request DTO][search-request] · [Client][search-client]

**Search response fields:**

- Top level: `flights` array, `summary` object.
- `flights[]`: `flightId`, `airlineCode`, `airlineName`, `flightNumber`, `departureAirport`, `departureCity`, `departureTime`, `arrivalAirport`, `arrivalCity`, `arrivalTime`, `durationMinutes` integer, `flightType`, `fareOptions` array, `hasWifi` boolean, `hasPowerOutlet` boolean, `co2Emission` string.
- `fareOptions[]`: `fareId`, `providerName`, `price` JSON number/BigDecimal, `currency`, `cabinClass`, `baggageInfo`, `rating` integer, `reviewCount` integer, **`recommended` boolean**, `paymentOption` nullable string, `fareBrand`, `description`.
- `baggageInfo`: `cabinBags`, `checkedBags` integers; `cabinBagIncluded`, `checkedBagIncluded` booleans.
- `summary`: `totalResults` integer, `lowestPrice`, `highestPrice` numbers, `sortBy` string, `datePrices` array.
- `datePrices[]`: `date` string formatted **`dd MMM`**, `minPrice` number, **`selected` boolean**. Do not treat this abbreviated display date as the booking departure date.

The Java members named `isRecommended` and `isSelected` are not the wire names: historical captured JSON explicitly records `recommended` and `selected`, consistent with the generated boolean accessors. This historical corroboration is not a smoke test of the current local container. Nullable fields can be omitted (`NON_NULL`); the mock sets `paymentOption` null. Date/time properties are local date-time values, with no airport-timezone contract. Preserve the selected returned values rather than inventing timezone conversions. [Response DTO][search-response] · [Historical wire keys][historical-search] · [Airline generation][mock-generation] · [Serialization config][airline-config]

### 2. Prepare locally, with no reservation mutation

The existing detail-page function selects `selectedFlight.fareOptions.find(f => f.fareId === fareId)` and saves **`bookingInfo = {flight: selectedFlight, fare: selectedFare}`** to sessionStorage before opening `/booking.html`. [detail.js lines 178–190][prepare]

For a chat adapter, keep the selected flight **and fare from the same search snapshot**, display route/date/flight/fare/amount/currency and synthetic passenger/contact data, then require confirmation before book. This is an adapter safety recommendation, **not** an upstream hold, quote lock, price guarantee, prepare token, or inventory reservation.

### 3. Book

```json
{
  "flightId": "<selected flights[].flightId>",
  "fareId": "<fareId from that flight's fareOptions[]>",
  "passengers": [{
    "passengerType": "ADULT",
    "firstName": "John",
    "lastName": "Doe",
    "documentType": "PASSPORT",
    "documentNumber": "123456789",
    "dateOfBirth": "1990-01-01",
    "nationality": "US"
  }],
  "contactInfo": {
    "phone": "<synthetic nonblank phone>",
    "email": "test@example.com",
    "address": "<optional synthetic address>"
  }
}
```

Required at the outer validated DTO: nonblank `flightId`, `fareId`; nonempty `passengers`; nonnull `contactInfo`. Passenger member contract: `passengerType` (`ADULT | CHILD | INFANT`), `firstName`, `lastName`, `documentType` (`PASSPORT | ID_CARD`), `documentNumber`, `nationality`; optional `dateOfBirth` string, used by the UI for children/infants. Contact member contract: `phone`, `email`; optional `address`. Nested members carry NotBlank annotations but the outer properties have no cascading `@Valid`. **The existing booking UI omits nationality even though the DTO describes it as required**; a new adapter should include synthetic nationality rather than depend on that validation gap. [Booking DTO][booking-request] · [Booking client lines 198–239][booking-client]

**Book/query response fields:**

- Top level: `bookingId`, `status`, `flightInfo`, `passengers`, `paymentInfo`, `bookingDate`, `confirmationNumber`.
- `flightInfo`: `flightId`, `flightNumber`, `departureAirport`, `departureCity`, `departureTime`, `arrivalAirport`, `arrivalCity`, `arrivalTime`, `cabinClass`.
- `passengers[]`: `passengerId`, `passengerType`, `firstName`, `lastName`, `documentType`, `documentNumber`, `seatNumber`, `mealPreference`.
- `paymentInfo`: `paymentId`, `amount` number, `currency`, `paymentMethod`, `paymentStatus`, `paymentDate`.

There is **no returned `fareId`** in BookingResponse, and contactInfo/nationality/dateOfBirth are not echoed. Generated ID shapes are `FL<epochMillis><random integer>` for flights, `FARE<epochMillis><fare-index>` for fares, `BK<epochMillis>` for bookings, and a six-character uppercase-alphanumeric confirmation number. Preserve actual returned identifiers exactly. [Booking response DTO][booking-response] · [Mock booking][mock-booking] · [Mock generation][mock-generation]

### 4. Query the returned confirmation

```json
{
  "confirmationNumber": "<exact book response confirmationNumber>",
  "passengerLastName": "Doe"
}
```

Both are required nonblank strings. This is a POST JSON endpoint, not GET by bookingId. It returns the same BookingResponse type. The airline map lookup uses the confirmation exactly; last-name verification uses the **first passenger**, case-insensitively, and permits the original full surname when the stored surname was truncated. [Query DTO][query-request] · [Order client][orders-client] · [Query service lines 319–338][mock-query]

## Booking consistency and the payment distinction

Source-confirmed hazards; these are reasons to verify rather than trust the green UI:

1. Booking sets **`status: "CONFIRMED"` before validating flight/fare lookup**. A missing/mismatched ID can still produce a saved confirmed booking with missing `flightInfo`, amount `0`, and USD. Require populated `flightInfo`, exact selected `flightId`, matching route/date/time/cabin, positive amount matching the selected fare, and matching currency. A 200 plus CONFIRMED is insufficient. [Mock booking lines 37–112][mock-booking]
2. OTA `bookFlight` first performs an unrelated **New York → Los Angeles, today+7** search, then books the original submitted IDs. That pre-search does not recreate a lost selected flight. The selected original search must have reached the same still-live airline instance. [OTA service lines 79–111][ota-service]
3. The airline stores flights/bookings in in-memory `HashMap`s. Restart loses them; there is no durable reservation store in this image-linked version. Random/millisecond IDs have no demonstrated uniqueness or idempotency guarantee. [Mock state and creation][mock-booking]
4. Returned passenger first/last names are truncated to **10 characters**. The backend's booked amount is **one selected fare price**, not multiplied by passenger count. Prefer the source's one-adult fixture for the demo and explicitly surface discrepancies for larger parties. [Mock booking lines 73–105][mock-booking]
5. Immediately after book: `status="CONFIRMED"`, but `paymentInfo.paymentId`, `paymentMethod`, and `paymentStatus` are all **`"PENDING"`**. This means **reserved in the mock, not paid**. [Mock booking lines 90–106][mock-booking]
6. Payment is a separate mutation. `POST /api/flights/payandissue` takes `bookingId`, `paymentMethod`, positive `amount`, `currency`, and `paymentDetails`. Nested field names are `cardNumber`, `cardHolderName`, `expiryDate`, `cvv`, optional billing fields. **No card values are needed for search/book/query, and no payment request was made.** [Payment DTO][payment-request]
7. The payment mock returns `status="SUCCESS"` and changes the stored booking's `paymentStatus` to `PAID`. It merely simulates processing; it is not proof of real settlement or ticket issuance. Payment response fields: `paymentId`, `status`, `bookingId`, `amount`, `currency`, `paymentMethod`, `paymentDate`, `transactionId`, `message`, `errorCode`; the implementation does not populate every declared field (`bookingId`/`errorCode` may be absent). [Mock payment lines 115–141][mock-booking] · [Payment response DTO][payment-response]

**Recommended confirmation acceptance:** issue a separate query using the returned confirmation and first passenger surname; compare its `bookingId`, `confirmationNumber`, selected flight identity/route/date, passenger count/identifiers, amount/currency, and paymentStatus to the original response and prepared selection. Keep fareId in local prepared state because the server does not echo it. State clearly **"mock booking confirmed; payment pending"** unless a separate authorized payment was actually performed and read back.

## Mock cities, routes, dates, and prices

The pinned UI and airline city lookup agree on these **19** airport codes:

`LHR` London; `CDG` Paris; `FRA` Frankfurt; `AMS` Amsterdam; `MAD` Madrid; `BCN` Barcelona; `FCO` Rome; `MXP` Milan; `ZRH` Zurich; `VIE` Vienna; `CPH` Copenhagen; `ARN` Stockholm; `OSL` Oslo; `HEL` Helsinki; `WAW` Warsaw; `PRG` Prague; `BUD` Budapest; `ATH` Athens; `IST` Istanbul. [Pinned HTML lines 155–214][airports] · [Lookup lines 292–315][mock-generation]

- There is **no fixed route inventory or fixed demo-date window** in the examined source. Each search generates 10 random direct flights for the submitted origin/destination/date, stores them, and returns them. Unknown airport strings fall back to their input as the city name; no same-city prohibition or future-date check appears in the DTO/service. Use a sensible future date and the documented codes instead of relying on this laxity. [Search DTO][search-request] · [Search/store loop][mock-booking] · [Mock generation][mock-generation]
- UI default is tomorrow; the unit-test route is LHR → CDG on today+7. The date input has no `min` or `max`. [search.js lines 11–16][search-client] · [Fixture][fixture] · [Pinned HTML][airports]
- `tripType` is not used to generate a return leg, and there is no returnDate request member. Requested cabin/passenger counts do not drive flight generation; all returned mock fares are **ECONOMY/USD**, with brands Basic/Standard/Flex/Premium. Do not promise real round-trip or business-class behavior just because the UI offers those inputs. [DTO][search-request] · [Generation lines 144–239][mock-generation]
- Base price is randomly selected from 750–849 USD; fare multipliers use integer arithmetic at 100%, 125%, 150%, 175%. Prices and IDs change between searches. `summary.datePrices` are synthetic display values, not independently booked inventory. [Generation lines 194–280][mock-generation]

## Errors and safe adapter behavior

**Observed source handling:** OTA search/book/query catch service exceptions and return **HTTP 400** JSON `{ "error": <operation label>, "message": <exception text>, "timestamp": <local datetime> }`. The labels are `Flight search failed`, `Flight booking failed`, `Order query failed`. Payment catches may return **400 with an empty body**. Validation/JSON-binding failures occur before method execution and may have Spring error-body shapes instead. Airline query exceptions are swallowed into empty-body 400; OTA can therefore expose only the wrapped upstream HTTP error, not a clean NOT_FOUND code. [OTA controller][controller] · [Airline controller][airline-controller]

Recommended client handling (not existing server guarantees):

- Read the body once as text, parse JSON defensively, and validate both HTTP status and the expected response shape. Handle empty/non-JSON bodies explicitly; do not copy the UI's assumption that every error is JSON.
- Treat missing flightInfo/zero amount/mismatched route or booking IDs as a consistency failure, not a successful booking.
- Do not blindly retry book or payment after timeout, network failure, 5xx, or malformed success. No idempotency-key handling is implemented in the examined route/service. If a confirmation was returned, query it; if the response was lost and no identifier is known, expose an **unknown outcome** instead of creating a duplicate.
- Search/query can be retried cautiously with bounded timeouts, but another search produces a different random snapshot; do not silently replace a prepared selection.
- Keep error text untrusted/escaped and redact PII and any credentials in diagnostics. Existing code logs headers, booking requests, and payment requests; do not copy those logging patterns into the adapter.
- Keep booking and payment explicit separate actions; the approved search/book/query path must not trigger payment.

## Version trap and runtime-only unknowns

The older `sp-airline:v2.0.1` provenance points to `demo-air@d56d6e0a30559abba2b4c43902628cb5ed67dbb9`; that controller declares search, book, payment, health, **but no order-query endpoint**. Do not pair it with this confirmation-query workflow. The pinned compose already specifies v2.0.3. [Older controller][old-controller] · [Compose][compose]

Not tested because this task permits only read-only source/network inspection: actual local container availability, startup health, currently installed digests, successful local search/booking/query, browser CORS/proxy behavior, state survival across the parent's deployment operations, and runtime error serialization. Registry source attribution is a BuildKit provenance assertion with incomplete materials/reproducibility metadata, not a rebuild. No model calls, booking/payment mutations, Docker commands, installations, or application/deployment configuration changes were performed.

## Artifacts and verification

All task artifacts are under `/Users/onur/.hermes/cache/scratch/sp-ota-contract-c1885d7/`; no files in the parent's `TravelAgentDemo/upstream` directory were edited.

- `CONTRACT.md`: this report.
- `contract.json`: machine-readable endpoint and nested field-shape contract, source-derived synthetic fixture, and safety requirements.
- `contract-evidence.json`: URL-keyed excerpts/body paths/line ranges for parent citation registration.
- `static-verification.json`: programmatic checks of all 31 excerpt ranges, 19 unique UI airport codes, required OTA route declarations, and absence of a prepare endpoint.
- `contract-verification.json`: all 18 declared DTO shapes matched to source fields, 28 source-link line ranges checked, four provenance records checked, JSON templates parsed, and architecture metadata checked; source verification PASS, runtime untested.
- `home-server/`: fetched pinned deployment assets.
- `demo-air-v2.0.3/`: matching source snapshot; one upstream Dockerfile credential literal has been redacted in the local copy and is not needed for the contract.
- `registry-evidence/`: original OCI indexes, attestation manifests/provenance, URL/path index; `registry-*.json` and `dockerhub-*.json`: inspected metadata.
- `demo-air/`: exploratory newer-main files, **not the deployed contract**. `historical-api-catalog/`: corroborating historical field names, **not local runtime results**.

Reusable procedural memory was saved separately as the default-profile skill `container-api-contract-research`; it contains no credentials or app configuration.

## Source links (URL-keyed for parent integration)

[compose]: https://github.com/softprobe/deployment-k8s/blob/c1885d713430f193a867e4772b85420d06f82b5e/home-server/docker-compose.staging.yaml#L1-L26
[html-scripts]: https://github.com/softprobe/deployment-k8s/blob/c1885d713430f193a867e4772b85420d06f82b5e/home-server/travel-ui-web/index.html#L294-L299
[instrumentation]: https://github.com/softprobe/deployment-k8s/blob/c1885d713430f193a867e4772b85420d06f82b5e/home-server/docker-staging.md#L26-L33
[airports]: https://github.com/softprobe/deployment-k8s/blob/c1885d713430f193a867e4772b85420d06f82b5e/home-server/travel-ui-web/index.html#L155-L214
[controller]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/travel-ota/src/main/java/org/example/controller/FlightController.java#L16-L105
[ota-service]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/travel-ota/src/main/java/org/example/service/FlightService.java#L32-L208
[airline-controller]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/sp-airline/src/main/java/com/airline/sp/controller/AirlineController.java#L13-L88
[search-client]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/travel-ota/src/main/resources/static/js/search.js#L1-L140
[prepare]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/travel-ota/src/main/resources/static/js/detail.js#L178-L190
[booking-client]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/travel-ota/src/main/resources/static/js/booking.js#L198-L254
[orders-client]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/travel-ota/src/main/resources/static/js/orders.js#L6-L41
[sessions]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/travel-ota/src/main/resources/static/js/sessionManager.js#L6-L32
[search-request]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/airline-common/src/main/java/com/airline/common/model/FlightSearchRequest.java#L9-L41
[search-response]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/airline-common/src/main/java/com/airline/common/model/FlightSearchResponse.java#L8-L72
[booking-request]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/airline-common/src/main/java/com/airline/common/model/BookingRequest.java#L9-L57
[booking-response]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/airline-common/src/main/java/com/airline/common/model/BookingResponse.java#L8-L52
[query-request]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/airline-common/src/main/java/com/airline/common/model/OrderQueryRequest.java#L6-L14
[payment-request]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/airline-common/src/main/java/com/airline/common/model/PaymentRequest.java#L11-L49
[payment-response]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/airline-common/src/main/java/com/airline/common/model/PaymentResponse.java#L7-L19
[mock-booking]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/sp-airline/src/main/java/com/airline/sp/service/FlightService.java#L14-L142
[mock-generation]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/sp-airline/src/main/java/com/airline/sp/service/FlightService.java#L144-L315
[mock-query]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/sp-airline/src/main/java/com/airline/sp/service/FlightService.java#L319-L338
[fixture]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/sp-airline/src/test/java/com/airline/sp/service/FlightServiceTest.java#L27-L120
[ota-config]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/travel-ota/src/main/resources/application.yml#L1-L48
[airline-config]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/sp-airline/src/main/resources/application.yml#L1-L15
[release]: https://github.com/softprobe/demo-air/blob/c21fe8de7ef161b02b5779bee06548ca284351bd/.github/workflows/release.yml#L90-L101
[historical-search]: https://github.com/softprobe/softprobe-agent/blob/45fbe9fc39661a38a58b7d575debddf3f53c2b16/data/example/tenant-1761658980224/api-insights/api-catalog/demo-ota/inbound/POST-api-flights-search.json#L493-L1055
[old-controller]: https://github.com/softprobe/demo-air/blob/d56d6e0a30559abba2b4c43902628cb5ed67dbb9/sp-airline/src/main/java/com/airline/sp/controller/AirlineController.java#L13-L73
[ota-tag]: https://hub.docker.com/v2/repositories/softprobe/sp-ota/tags/v2.0.3
[airline-tag]: https://hub.docker.com/v2/repositories/softprobe/sp-airline/tags/v2.0.3
[ota-provenance]: https://registry-1.docker.io/v2/softprobe/sp-ota/blobs/sha256:3a1d63658fa06c78fb5bc14fd9c9b2d8c1569ab2e27d8f552adbbb2609e6dcf1
[airline-provenance]: https://registry-1.docker.io/v2/softprobe/sp-airline/blobs/sha256:39dda7d263940cb6b6c859da636ed91427de7bf92dcf456aea997b655b9c2125
