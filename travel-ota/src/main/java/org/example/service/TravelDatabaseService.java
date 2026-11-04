package org.example.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.model.BookingResponse;
import org.example.model.OrderQueryRequest;
import org.example.model.PaymentResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class TravelDatabaseService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public TravelDatabaseService(
            JdbcTemplate jdbc,
            ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public void saveBooking(BookingResponse booking) {
        if (booking.getPassengers() == null || booking.getPassengers().isEmpty()) {
            return;
        }
        String bookingJson = toJson(booking);
        jdbc.update(
                "MERGE INTO ota_orders (confirmation_number, passenger_last_name, booking_json) "
                        + "KEY (confirmation_number) VALUES (?, ?, ?)",
                booking.getConfirmationNumber(),
                booking.getPassengers().get(0).getLastName(),
                bookingJson);
    }

    public void savePayment(PaymentResponse payment) {
        if (payment == null || !"SUCCESS".equalsIgnoreCase(payment.getStatus())) {
            return;
        }
        jdbc.update(
                "MERGE INTO ota_payments (payment_id, booking_id, status, amount, currency) "
                        + "KEY (payment_id) VALUES (?, ?, ?, ?, ?)",
                payment.getPaymentId(),
                payment.getBookingId(),
                payment.getStatus(),
                payment.getAmount(),
                payment.getCurrency());
    }

    public BookingResponse findBooking(OrderQueryRequest query) {
        List<String> rows = jdbc.query(
                "SELECT booking_json FROM ota_orders "
                        + "WHERE confirmation_number = ? AND passenger_last_name = ?",
                (resultSet, rowNum) -> resultSet.getString(1),
                query.getConfirmationNumber(),
                query.getPassengerLastName());
        if (rows.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.readValue(rows.get(0), BookingResponse.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("stored booking could not be decoded", e);
        }
    }

    private String toJson(BookingResponse booking) {
        try {
            return objectMapper.writeValueAsString(booking);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("booking could not be encoded for storage", e);
        }
    }
}
