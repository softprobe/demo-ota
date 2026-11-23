package org.example.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.example.model.BookingRequest;
import org.example.model.BookingResponse;
import org.example.model.ChangeFlightRequest;
import org.example.model.ChangeFlightResponse;
import org.example.model.PaymentRequest;
import org.example.model.PaymentResponse;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Optional;

@Service
public class OtaPersistenceService {

    public record OrderSummary(
            String bookingId,
            String confirmationNumber,
            String status,
            String paymentStatus,
            String contactEmail) {}

    public record BookingSessionRow(String sessionId, String offersJson, String pendingJson) {}

    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper mapper;

    public OtaPersistenceService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
        this.mapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    public long countOrdersForRoute(String departureAirport, String arrivalAirport) {
        Long count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM ota_orders WHERE departure_airport = ? AND arrival_airport = ?",
                Long.class,
                departureAirport,
                arrivalAirport);
        return count == null ? 0L : count;
    }

    public void upsertOrderFromBooking(BookingRequest request, BookingResponse response) {
        if (response == null || response.getBookingId() == null || response.getBookingId().isBlank()) {
            return;
        }
        String bookingId = response.getBookingId();
        String confirmation = response.getConfirmationNumber() == null ? bookingId : response.getConfirmationNumber();
        String status = response.getStatus() == null ? "CONFIRMED" : response.getStatus();
        BookingResponse.PaymentInfo pay = response.getPaymentInfo();
        String paymentStatus = pay != null && pay.getPaymentStatus() != null ? pay.getPaymentStatus() : "PENDING";
        BookingResponse.FlightInfo flight = response.getFlightInfo();
        String flightId = flight != null && flight.getFlightId() != null ? flight.getFlightId() : request.getFlightId();
        String fareId = request != null ? request.getFareId() : null;
        String flightNumber = flight != null ? flight.getFlightNumber() : null;
        String depAirport = flight != null ? flight.getDepartureAirport() : null;
        String arrAirport = flight != null ? flight.getArrivalAirport() : null;
        String depTime = flight != null && flight.getDepartureTime() != null ? flight.getDepartureTime().format(ISO) : null;
        String arrTime = flight != null && flight.getArrivalTime() != null ? flight.getArrivalTime().format(ISO) : null;
        String cabinClass = flight != null ? flight.getCabinClass() : null;

        String firstName = null;
        String lastName = null;
        if (response.getPassengers() != null && !response.getPassengers().isEmpty()) {
            firstName = response.getPassengers().get(0).getFirstName();
            lastName = response.getPassengers().get(0).getLastName();
        } else if (request != null && request.getPassengers() != null && !request.getPassengers().isEmpty()) {
            firstName = request.getPassengers().get(0).getFirstName();
            lastName = request.getPassengers().get(0).getLastName();
        }
        String contactEmail = request != null && request.getContactInfo() != null
                ? request.getContactInfo().getEmail()
                : null;
        BigDecimal amount = pay != null ? pay.getAmount() : null;
        String currency = pay != null ? pay.getCurrency() : null;
        String payloadJson = toJson(response);

        String updateSql = """
                UPDATE ota_orders
                SET confirmation_number = ?,
                    status = ?,
                    payment_status = ?,
                    flight_id = ?,
                    fare_id = COALESCE(?, fare_id),
                    flight_number = ?,
                    departure_airport = ?,
                    arrival_airport = ?,
                    departure_time = ?,
                    arrival_time = ?,
                    cabin_class = ?,
                    passenger_first_name = ?,
                    passenger_last_name = ?,
                    contact_email = COALESCE(?, contact_email),
                    amount = ?,
                    currency = ?,
                    payload_json = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE booking_id = ?
                """;
        Object[] updateArgs = new Object[]{
                confirmation, status, paymentStatus, flightId, fareId, flightNumber,
                depAirport, arrAirport, depTime, arrTime, cabinClass,
                firstName, lastName, contactEmail, amount, currency, payloadJson, bookingId
        };
        int updated = jdbcTemplate.update(updateSql, updateArgs);
        if (updated == 0) {
            String insertSql = """
                    INSERT INTO ota_orders (
                        booking_id, confirmation_number, status, payment_status,
                        flight_id, fare_id, flight_number, departure_airport, arrival_airport,
                        departure_time, arrival_time, cabin_class,
                        passenger_first_name, passenger_last_name, contact_email,
                        amount, currency, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """;
            try {
                jdbcTemplate.update(
                        insertSql,
                        bookingId, confirmation, status, paymentStatus,
                        flightId, fareId, flightNumber, depAirport, arrAirport,
                        depTime, arrTime, cabinClass,
                        firstName, lastName, contactEmail,
                        amount, currency, payloadJson);
            } catch (DuplicateKeyException ignored) {
                jdbcTemplate.update(updateSql, updateArgs);
            }
        }
    }

    public void upsertOrderSnapshot(BookingResponse response) {
        upsertOrderFromBooking(null, response);
    }

    public void recordPayment(PaymentRequest request, PaymentResponse response, String authorizationId) {
        String bookingId = request.getBookingId();
        String paymentId = response != null && response.getPaymentId() != null && !response.getPaymentId().isBlank()
                ? response.getPaymentId()
                : "pay_" + bookingId;
        String txId = response != null ? response.getTransactionId() : null;
        String status = response != null && response.getStatus() != null ? response.getStatus() : "SUCCESS";
        BigDecimal amount = request.getAmount();
        String currency = request.getCurrency();
        String method = request.getPaymentMethod();

        String updatePayment = """
                UPDATE ota_payments
                SET booking_id = ?,
                    authorization_id = COALESCE(?, authorization_id),
                    transaction_id = ?,
                    status = ?,
                    amount = ?,
                    currency = ?,
                    payment_method = ?
                WHERE payment_id = ?
                """;
        int updated = jdbcTemplate.update(
                updatePayment, bookingId, authorizationId, txId, status, amount, currency, method, paymentId);
        if (updated == 0) {
            String insertPayment = """
                    INSERT INTO ota_payments (
                        payment_id, booking_id, authorization_id, transaction_id,
                        status, amount, currency, payment_method
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """;
            try {
                jdbcTemplate.update(
                        insertPayment, paymentId, bookingId, authorizationId, txId, status, amount, currency, method);
            } catch (DuplicateKeyException ignored) {
                jdbcTemplate.update(
                        updatePayment, bookingId, authorizationId, txId, status, amount, currency, method, paymentId);
            }
        }

        if ("SUCCESS".equalsIgnoreCase(status)) {
            jdbcTemplate.update(
                    "UPDATE ota_orders SET payment_status = 'PAID', updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?",
                    bookingId);
        }
    }

    public Optional<OrderSummary> findOrderByBookingId(String bookingId) {
        if (bookingId == null || bookingId.isBlank()) {
            return Optional.empty();
        }
        List<OrderSummary> rows = jdbcTemplate.query(
                "SELECT booking_id, confirmation_number, status, payment_status, contact_email FROM ota_orders WHERE booking_id = ?",
                (rs, rowNum) -> new OrderSummary(
                        rs.getString("booking_id"),
                        rs.getString("confirmation_number"),
                        rs.getString("status"),
                        rs.getString("payment_status"),
                        rs.getString("contact_email")),
                bookingId);
        return rows.stream().findFirst();
    }

    public Optional<OrderSummary> findOrderByConfirmation(String confirmationNumber) {
        if (confirmationNumber == null || confirmationNumber.isBlank()) {
            return Optional.empty();
        }
        List<OrderSummary> rows = jdbcTemplate.query(
                "SELECT booking_id, confirmation_number, status, payment_status, contact_email FROM ota_orders WHERE confirmation_number = ?",
                (rs, rowNum) -> new OrderSummary(
                        rs.getString("booking_id"),
                        rs.getString("confirmation_number"),
                        rs.getString("status"),
                        rs.getString("payment_status"),
                        rs.getString("contact_email")),
                confirmationNumber);
        return rows.stream().findFirst();
    }

    public void markOrderRefunded(String bookingId) {
        if (bookingId == null || bookingId.isBlank()) {
            return;
        }
        jdbcTemplate.update(
                "UPDATE ota_orders SET status = 'CANCELLED', payment_status = 'REFUNDED', updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?",
                bookingId);
    }

    public void recordFlightChange(ChangeFlightRequest request, ChangeFlightResponse response) {
        if (request == null || request.getOriginalBookingId() == null) {
            return;
        }
        jdbcTemplate.update(
                "UPDATE ota_orders SET flight_id = ?, fare_id = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?",
                request.getNewFlightId(),
                request.getNewFareId(),
                request.getOriginalBookingId());
        if (response != null && response.getNewBookingId() != null
                && !response.getNewBookingId().equals(request.getOriginalBookingId())) {
            String confirmation = response.getNewConfirmationNumber() != null
                    ? response.getNewConfirmationNumber()
                    : request.getConfirmationNumber();
            int updated = jdbcTemplate.update(
                    "UPDATE ota_orders SET confirmation_number = ?, flight_id = ?, fare_id = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?",
                    confirmation,
                    request.getNewFlightId(),
                    request.getNewFareId(),
                    response.getNewBookingId());
            if (updated == 0) {
                try {
                    jdbcTemplate.update(
                            """
                            INSERT INTO ota_orders (
                                booking_id, confirmation_number, status, payment_status,
                                flight_id, fare_id, departure_airport, arrival_airport,
                                passenger_last_name, amount, currency
                            ) VALUES (?, ?, 'CONFIRMED', 'PAID', ?, ?, ?, ?, ?, ?, ?)
                            """,
                            response.getNewBookingId(),
                            confirmation,
                            request.getNewFlightId(),
                            request.getNewFareId(),
                            request.getNewDepartureCity(),
                            request.getNewArrivalCity(),
                            request.getPassengerLastName(),
                            response.getNewPrice(),
                            response.getCurrency());
                } catch (DuplicateKeyException ignored) {
                }
            }
        }
    }

    public void touchOrderBaggage(String bookingId) {
        if (bookingId == null || bookingId.isBlank()) {
            return;
        }
        jdbcTemplate.update(
                "UPDATE ota_orders SET updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?",
                bookingId);
    }

    public Optional<BookingSessionRow> loadBookingSession(String sessionId) {
        List<BookingSessionRow> rows = jdbcTemplate.query(
                "SELECT session_id, offers_json, pending_json FROM ota_booking_sessions WHERE session_id = ?",
                (rs, rowNum) -> new BookingSessionRow(
                        rs.getString("session_id"),
                        rs.getString("offers_json"),
                        rs.getString("pending_json")),
                sessionId);
        return rows.stream().findFirst();
    }

    public void saveBookingSession(String sessionId, String offersJson, String pendingJson) {
        int updated = jdbcTemplate.update(
                "UPDATE ota_booking_sessions SET offers_json = ?, pending_json = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?",
                offersJson,
                pendingJson,
                sessionId);
        if (updated == 0) {
            try {
                jdbcTemplate.update(
                        "INSERT INTO ota_booking_sessions (session_id, offers_json, pending_json) VALUES (?, ?, ?)",
                        sessionId,
                        offersJson,
                        pendingJson);
            } catch (DuplicateKeyException ignored) {
                jdbcTemplate.update(
                        "UPDATE ota_booking_sessions SET offers_json = ?, pending_json = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?",
                        offersJson,
                        pendingJson,
                        sessionId);
            }
        }
    }

    private String toJson(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize order payload", e);
        }
    }
}
