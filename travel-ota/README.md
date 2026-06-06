# Travel OTA

A demo flight booking system built with JDK 21 and Spring Boot 3.x. It includes a full flow from search to booking and payment, plus a static web UI served by the OTA service.

## Features

### Frontend pages
1. **Search page** (`/`) - flight search form
   - Trip type selection (one-way/round-trip)
   - Origin and destination
   - Departure date
   - Passenger count and cabin class

2. **Results page** (`/list.html`) - search results
   - Date price navigation
   - Flight list
   - Fare options
   - Sorting and filtering

3. **Details page** (`/detail.html`) - flight details
   - Full itinerary details
   - Brand fare comparison
   - Baggage and amenities

4. **Booking page** (`/booking.html`) - passenger details
   - Passenger information form
   - Contact details
   - Price summary

5. **Payment page** (`/payment.html`) - payment and ticketing
   - Multiple payment methods
   - Payment status
   - Ticket issuance result

### Backend APIs
1. **Search** (`POST /api/flights/search`)
   - Search flights by criteria
   - Returns flight list and fare info

2. **Booking** (`POST /api/flights/book`)
   - Book a selected fare
   - Generates a PNR

3. **Payment & issue** (`POST /api/flights/payandissue`)
   - Pay by PNR
   - Returns ticket number on success

## Spring config replay demo (internal only)

`RegionTenantCodeConfig` uses `@Value` on setters → static fields → inner enum constants. Search applies **regional tax** to airline fares in `FlightService` (MEA 8%, EU 20% via `tenant.sales-region`); the public search API shape is unchanged.

At replay, inject a different `tenant.sales-region` (e.g. `EU` vs recorded `MEA`) so tax — and fare prices — differ; replay diff fails if static config is not refreshed. Test: `mvn test -Dtest=RegionTenantCodeConfigTest`.

## Tech stack

### Backend
- **JDK 21**
- **Spring Boot 3.2.0**
- **Spring Web**
- **Spring Validation**
- **Lombok**
- **Jackson**

### Frontend
- **HTML5/CSS3**
- **JavaScript (ES6+)**
- **Bootstrap 5**
- **Font Awesome**

## Project structure

```
travel-ota
├── src
│   ├── main
│   │   ├── java
│   │   │   └── org/example
│   │   │       ├── TravelOtaApplication.java
│   │   │       ├── controller
│   │   │       │   └── FlightController.java
│   │   │       ├── model
│   │   │       ├── service
│   │   │       │   └── FlightService.java
│   │   │       └── config
│   │   └── resources
│   │       ├── static
│   │       │   ├── index.html
│   │       │   ├── list.html
│   │       │   ├── detail.html
│   │       │   ├── booking.html
│   │       │   ├── payment.html
│   │       │   └── js
│   │       └── application.yml
│   └── test
├── pom.xml
└── README.md
```

## Quick start

### Prerequisites
- Java 21
- Maven 3.9+

### Run
1. Build
   ```bash
   mvn clean install -DskipTests
   ```

2. Start the OTA service
   ```bash
   ./run.sh
   ```

3. Open http://localhost:8080

## Sample data
This service uses mocked data and does not require a database:
- Flight data for multiple carriers
- Fare options across suppliers
- Booking flow with generated PNR and ticket number
- Simulated payment success

## Notes
- `application.yml` controls server port, logging, and mock latency.
- Frontend assets are served from `src/main/resources/static`.
