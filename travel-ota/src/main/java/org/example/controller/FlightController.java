package org.example.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.example.model.*;
import org.example.service.FlightService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;

import org.example.service.AuthenticateService;

@RestController
@RequestMapping("/api/flights")
@CrossOrigin(origins = "*")
public class FlightController {
    private static final Logger logger = LoggerFactory.getLogger(FlightController.class);

    @Autowired
    private FlightService flightService;

    @Autowired
    private AuthenticateService authenticateService;

    @PostMapping("/search")
    public ResponseEntity<Object> searchFlights(@Valid @RequestBody FlightSearchRequest request, HttpServletRequest httpRequest) {
        try {
            // Log request headers
            System.out.println("=== Request Headers for /search ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });

            // Call internal AuthenticateService to demonstrate dynamic class recording/mocking
            boolean authenticated = authenticateService.authenticate("user_e2e", "pass_secret");
            logger.info("Internal Authentication Service result: {}", authenticated);

            FlightSearchResponse response = flightService.searchFlights(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            // Return detailed error information
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("error", "Flight search failed");
            errorResponse.put("message", e.getMessage());
            errorResponse.put("timestamp", LocalDateTime.now());
            return ResponseEntity.badRequest().body(errorResponse);
        }
    }

    @PostMapping("/book")
    public ResponseEntity<Object> bookFlight(@Valid @RequestBody BookingRequest request, HttpServletRequest httpRequest) {
        try {
            // Log request headers
            System.out.println("=== Request Headers for /book ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });

            BookingResponse response = flightService.bookFlight(request);
            logger.info("Booking response: {}", response);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            // Return detailed error information
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("error", "Flight booking failed");
            errorResponse.put("message", e.getMessage());
            errorResponse.put("timestamp", LocalDateTime.now());
            return ResponseEntity.badRequest().body(errorResponse);
        }
    }

    @PostMapping("/payandissue")
    public ResponseEntity<PaymentResponse> payAndIssue(@Valid @RequestBody PaymentRequest request, HttpServletRequest httpRequest) {
        try {
            // Log request headers
            System.out.println("=== Request Headers for /payandissue ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });

            PaymentResponse response = flightService.payAndIssue(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.badRequest().build();
        }
    }

    @PostMapping("/orders/query")
    public ResponseEntity<Object> queryOrder(@Valid @RequestBody OrderQueryRequest request, HttpServletRequest httpRequest) {
        try {
            System.out.println("=== Request Headers for /orders/query ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });

            BookingResponse response = flightService.queryOrder(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("error", "Order query failed");
            errorResponse.put("message", e.getMessage());
            errorResponse.put("timestamp", LocalDateTime.now());
            return ResponseEntity.badRequest().body(errorResponse);
        }
    }

    @PostMapping("/refund/process")
    public ResponseEntity<Object> processRefund(@Valid @RequestBody RefundRequest request, HttpServletRequest httpRequest) {
        try {
            System.out.println("=== Request Headers for /refund/process ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });

            RefundResponse response = flightService.processRefund(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("error", "Refund processing failed");
            errorResponse.put("message", e.getMessage());
            errorResponse.put("timestamp", LocalDateTime.now());
            return ResponseEntity.badRequest().body(errorResponse);
        }
    }

    @PostMapping("/change")
    public ResponseEntity<Object> changeFlight(@Valid @RequestBody ChangeFlightRequest request, HttpServletRequest httpRequest) {
        try {
            System.out.println("=== Request Headers for /change ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });

            ChangeFlightResponse response = flightService.changeFlight(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("error", "Flight change failed");
            errorResponse.put("message", e.getMessage());
            errorResponse.put("timestamp", LocalDateTime.now());
            return ResponseEntity.badRequest().body(errorResponse);
        }
    }

    @PostMapping("/baggage/purchase")
    public ResponseEntity<Object> purchaseBaggage(@Valid @RequestBody BaggageRequest request, HttpServletRequest httpRequest) {
        try {
            System.out.println("=== Request Headers for /baggage/purchase ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });

            BaggageResponse response = flightService.purchaseBaggage(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("error", "Baggage purchase failed");
            errorResponse.put("message", e.getMessage());
            errorResponse.put("timestamp", LocalDateTime.now());
            return ResponseEntity.badRequest().body(errorResponse);
        }
    }
}
