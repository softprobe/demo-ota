# Airline Mock Service

A standalone Spring Boot service that provides mock airline API endpoints for flight operations.

## Overview

This service simulates a real airline API by providing endpoints for:
- Flight search
- Flight booking
- Payment processing and ticket issuance

## Features

- **Flight Search**: Search for available flights with mock data generation
- **Flight Booking**: Book flights and generate PNR numbers
- **Payment Processing**: Process payments and issue tickets
- **Mock Data**: Generates realistic flight data with various airlines, routes, and fare options

## API Endpoints

### Base URL
```
http://localhost:8081/airline-api/v1
```

### Endpoints

#### 1. Flight Search
- **POST** `/flights/search`
- **Request Body**: `FlightSearchRequest`
- **Response**: `FlightSearchResponse` with available flights and fare options

#### 2. Flight Booking
- **POST** `/flights/book`
- **Request Body**: `BookingRequest`
- **Response**: `BookingResponse` with booking confirmation and PNR

#### 3. Payment Processing
- **POST** `/payment/process`
- **Request Body**: `PaymentRequest`
- **Response**: `PaymentResponse` with payment confirmation and ticket details

#### 4. Health Check
- **GET** `/health`
- **Response**: Service status message

## Technology Stack

- **Java 21**
- **Spring Boot 3.2.0**
- **Maven**
- **Lombok**

## Getting Started

### Prerequisites
- Java 21 or higher
- Maven 3.6 or higher

### Running the Service

1. **Clone and navigate to the project directory**
   ```bash
   cd airline-mock-service
   ```

2. **Build the project**
   ```bash
   mvn clean install
   ```

3. **Run the service**
   ```bash
   mvn spring-boot:run
   ```

The service will start on port 8081 with context path `/airline-api`.

### Testing the API

You can test the API endpoints using tools like Postman, curl, or any HTTP client.

#### Example Flight Search Request:
```json
{
  "fromCity": "LHR",
  "toCity": "CDG",
  "departureDate": "2024-02-15",
  "tripType": "ONE_WAY",
  "passengerInfo": {
    "adults": 1,
    "children": 0,
    "infants": 0
  },
  "cabinClass": "ECONOMY"
}
```

## Configuration

The service configuration can be modified in `src/main/resources/application.yml`:

- **Port**: Default 8081
- **Context Path**: `/airline-api`
- **Logging**: Debug level for development

## Mock Data Features

- **Airlines**: 10 major European airlines with realistic codes
- **Routes**: Dynamic route generation based on airport codes
- **Fares**: 4 fare brands (Basic, Standard, Flex, Premium) with different pricing and baggage policies
- **Schedules**: Random departure times with realistic flight durations
- **Environmental Info**: Mock CO2 emission data

## Integration

This service is designed to be integrated with:
- Travel agency systems
- OTA platforms
- Testing and development environments
- API mocking scenarios

## Development

The service follows standard Spring Boot conventions:
- **Models**: Data transfer objects in `com.airline.sp.model`
- **Service**: Business logic in `com.airline.sp.service`
- **Controller**: REST endpoints in `com.airline.sp.controller`

## License

This is a demo project for educational and development purposes.
