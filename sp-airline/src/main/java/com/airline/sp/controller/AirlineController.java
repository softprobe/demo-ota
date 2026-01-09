package com.airline.sp.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.airline.common.model.*;
import com.airline.sp.service.FlightService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletRequest;

@RestController
@RequestMapping("/v1")
@CrossOrigin(origins = "*")
public class AirlineController {
    private static final Logger logger = LoggerFactory.getLogger(AirlineController.class);

    @Autowired
    private FlightService flightService;

    @PostMapping("/flights/search")
    public ResponseEntity<FlightSearchResponse> searchFlights(@Valid @RequestBody FlightSearchRequest request, HttpServletRequest httpRequest) {
        try {
            System.out.println("=== Request Headers for /flights/search ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });
            FlightSearchResponse response = flightService.searchFlights(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.badRequest().build();
        }
    }

    @PostMapping("/flights/book")
    public ResponseEntity<BookingResponse> bookFlight(@Valid @RequestBody BookingRequest request, HttpServletRequest httpRequest) {
        try {
            System.out.println("=== Request Headers for /flights/book ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });
            BookingResponse response = flightService.bookFlight(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.badRequest().build();
        }
    }

    @PostMapping("/payment/process")
    public ResponseEntity<PaymentResponse> processPayment(@Valid @RequestBody PaymentRequest request, HttpServletRequest httpRequest) {
        try {
            System.out.println("=== Request Headers for /payment/process ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });
            PaymentResponse response = flightService.payAndIssue(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            // Log the error for debugging
            logger.error("Payment processing failed", e);
            return ResponseEntity.badRequest().body(null);
        }
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("Airline Mock Service is running");
    }

    @PostMapping("/orders/query")
    public ResponseEntity<BookingResponse> queryOrder(@Valid @RequestBody OrderQueryRequest request, HttpServletRequest httpRequest) {
        try {
            System.out.println("=== Request Headers for /orders/query ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });
            BookingResponse response = flightService.queryOrder(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            logger.error("Order query failed", e);
            return ResponseEntity.badRequest().body(null);
        }
    }

    @PostMapping("/refund/process")
    public ResponseEntity<RefundResponse> processRefund(@Valid @RequestBody RefundRequest request, HttpServletRequest httpRequest) {
        try {
            System.out.println("=== Request Headers for /refund/process ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });
            RefundResponse response = flightService.processRefund(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            logger.error("Refund processing failed", e);
            return ResponseEntity.badRequest().body(null);
        }
    }

    @PostMapping("/flights/change")
    public ResponseEntity<ChangeFlightResponse> changeFlight(@Valid @RequestBody ChangeFlightRequest request, HttpServletRequest httpRequest) {
        try {
            System.out.println("=== Request Headers for /flights/change ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });
            ChangeFlightResponse response = flightService.changeFlight(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            logger.error("Flight change failed", e);
            return ResponseEntity.badRequest().body(null);
        }
    }

    @PostMapping("/baggage/purchase")
    public ResponseEntity<BaggageResponse> purchaseBaggage(@Valid @RequestBody BaggageRequest request, HttpServletRequest httpRequest) {
        try {
            System.out.println("=== Request Headers for /baggage/purchase ===");
            httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName -> {
                String headerValue = httpRequest.getHeader(headerName);
                logger.info("{}: {}", headerName, headerValue);
            });
            BaggageResponse response = flightService.purchaseBaggage(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            logger.error("Baggage purchase failed", e);
            return ResponseEntity.badRequest().body(null);
        }
    }
}
