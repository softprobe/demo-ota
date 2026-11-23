package org.example.controller;

import com.fasterxml.jackson.databind.JsonNode;
import org.example.booking.BookingSessionException;
import org.example.booking.BookingSessionModels.*;
import org.example.booking.BookingSessionService;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;

import java.util.Iterator;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/bookings/sessions")
@CrossOrigin(origins = "*")
public class BookingSessionController {

    private final BookingSessionService bookingSessionService;

    public BookingSessionController(BookingSessionService bookingSessionService) {
        this.bookingSessionService = bookingSessionService;
    }

    @GetMapping("/{sessionId}")
    public ResponseEntity<BookingSessionView> getSession(@PathVariable String sessionId) {
        return ResponseEntity.ok(bookingSessionService.getSession(sessionId));
    }

    @PostMapping("/{sessionId}/tools/search")
    public ResponseEntity<SearchToolResponse> search(
            @PathVariable String sessionId, @RequestBody(required = false) JsonNode body) {
        requireObjectWithAllowedFields(body, Set.of("origin", "destination", "date"));
        String origin = requireTextField(body, "origin");
        String destination = requireTextField(body, "destination");
        String date = requireTextField(body, "date");
        return ResponseEntity.ok(bookingSessionService.search(sessionId, origin, destination, date));
    }

    @PostMapping("/{sessionId}/tools/prepare")
    public ResponseEntity<PendingReview> prepare(
            @PathVariable String sessionId, @RequestBody(required = false) JsonNode body) {
        requireObjectWithAllowedFields(body, Set.of("offerId", "firstName", "lastName"));
        String offerId = requireTextField(body, "offerId");
        String firstName = requireTextField(body, "firstName");
        String lastName = requireTextField(body, "lastName");
        return ResponseEntity.ok(bookingSessionService.prepare(sessionId, offerId, firstName, lastName));
    }

    @PostMapping("/{sessionId}/approve")
    public ResponseEntity<ApproveResponse> approve(
            @PathVariable String sessionId, @RequestBody(required = false) JsonNode body) {
        requireObjectWithAllowedFields(body, Set.of("requestId", "injectSilentBug"));
        String requestId = requireTextField(body, "requestId");
        Boolean injectSilentBug = null;
        if (body.has("injectSilentBug") && !body.get("injectSilentBug").isNull()) {
            if (!body.get("injectSilentBug").isBoolean()) {
                throw new BookingSessionException(400, "injectSilentBug must be a boolean.");
            }
            injectSilentBug = body.get("injectSilentBug").booleanValue();
        }
        return ResponseEntity.ok(bookingSessionService.approve(sessionId, requestId, injectSilentBug));
    }

    @PostMapping("/{sessionId}/tools/book")
    public ResponseEntity<VerifiedBooking> book(
            @PathVariable String sessionId, @RequestBody(required = false) JsonNode body) {
        requireObjectWithAllowedFields(body, Set.of("requestId"));
        String requestId = requireTextField(body, "requestId");
        return ResponseEntity.ok(bookingSessionService.book(sessionId, requestId));
    }

    @PostMapping("/{sessionId}/tools/order")
    public ResponseEntity<VerifiedBooking> queryOrder(
            @PathVariable String sessionId, @RequestBody(required = false) JsonNode body) {
        if (body != null && !body.isNull()) {
            requireObjectWithAllowedFields(body, Set.of());
        }
        return ResponseEntity.ok(bookingSessionService.queryOrder(sessionId));
    }

    @PostMapping("/{sessionId}/pay")
    public ResponseEntity<PayResponse> pay(
            @PathVariable String sessionId, @RequestBody(required = false) JsonNode body) {
        requireObjectWithAllowedFields(body, Set.of("requestId"));
        String requestId = requireTextField(body, "requestId");
        return ResponseEntity.ok(bookingSessionService.pay(sessionId, requestId));
    }

    @PostMapping("/{sessionId}/cancel")
    public ResponseEntity<CancelResponse> cancel(
            @PathVariable String sessionId, @RequestBody(required = false) JsonNode body) {
        requireObjectWithAllowedFields(body, Set.of("requestId"));
        String requestId = requireTextField(body, "requestId");
        return ResponseEntity.ok(bookingSessionService.cancel(sessionId, requestId));
    }

    @ExceptionHandler(BookingSessionException.class)
    public ResponseEntity<Map<String, String>> handleBookingSessionException(BookingSessionException ex) {
        return ResponseEntity.status(ex.getStatus()).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, String>> handleMalformedJson(HttpMessageNotReadableException ex) {
        return ResponseEntity.badRequest().body(Map.of("error", "Invalid JSON request body."));
    }

    private static void requireObjectWithAllowedFields(JsonNode body, Set<String> allowedFields) {
        if (body == null || !body.isObject()) {
            throw new BookingSessionException(400, "JSON object body is required.");
        }
        Iterator<String> names = body.fieldNames();
        while (names.hasNext()) {
            String field = names.next();
            if (!allowedFields.contains(field)) {
                throw new BookingSessionException(400, "Unexpected field: " + field);
            }
        }
    }

    private static String requireTextField(JsonNode body, String field) {
        JsonNode node = body.get(field);
        if (node == null || !node.isTextual()) {
            throw new BookingSessionException(400, "Missing or invalid string field: " + field);
        }
        return node.asText();
    }
}
