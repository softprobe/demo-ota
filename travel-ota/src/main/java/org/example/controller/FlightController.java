package org.example.controller;

import org.example.model.*;
import org.example.service.FlightService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/flights")
public class FlightController {
    @Autowired
    private FlightService flightService;

    @PostMapping("/search")
    public ResponseEntity<Object> searchFlights(@Valid @RequestBody FlightSearchRequest request) {
        try {
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
    public ResponseEntity<Object> bookFlight(@Valid @RequestBody BookingRequest request) {
        try {
            BookingResponse response = flightService.bookFlight(request);
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
    public ResponseEntity<PaymentResponse> payAndIssue(@Valid @RequestBody PaymentRequest request) {
        try {
            PaymentResponse response = flightService.payAndIssue(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.badRequest().build();
        }
    }

    @PostMapping("/orders/query")
    public ResponseEntity<Object> queryOrder(@Valid @RequestBody OrderQueryRequest request) {
        try {
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
    public ResponseEntity<Object> processRefund(@Valid @RequestBody RefundRequest request) {
        try {
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
    public ResponseEntity<Object> changeFlight(@Valid @RequestBody ChangeFlightRequest request) {
        try {
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
    public ResponseEntity<Object> purchaseBaggage(@Valid @RequestBody BaggageRequest request) {
        try {
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
