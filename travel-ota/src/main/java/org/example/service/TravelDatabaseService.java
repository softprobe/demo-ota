package org.example.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.model.BookingResponse;
import org.example.model.OrderQueryRequest;
import org.example.model.PaymentResponse;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@Profile("obi-replay")
public class TravelDatabaseService {
    private final JdbcTemplate orders;
    private final JdbcTemplate payments;
    private final ObjectMapper objectMapper;

    public TravelDatabaseService(
            @Qualifier("ordersJdbcTemplate") JdbcTemplate orders,
            @Qualifier("paymentsJdbcTemplate") JdbcTemplate payments,
            ObjectMapper objectMapper) {
        this.orders = orders;
        this.payments = payments;
        this.objectMapper = objectMapper;
    }

    public void saveBooking(BookingResponse booking) {
        if (booking.getPassengers() == null || booking.getPassengers().isEmpty()) {
            return;
        }
        String bookingJson = toJson(booking);
        orders.update(
                "INSERT INTO ota_orders (confirmation_number, passenger_last_name, booking_json) "
                        + "VALUES (?, ?, ?::jsonb) "
                        + "ON CONFLICT (confirmation_number) DO UPDATE SET "
                        + "passenger_last_name = EXCLUDED.passenger_last_name, booking_json = EXCLUDED.booking_json",
                booking.getConfirmationNumber(),
                booking.getPassengers().get(0).getLastName(),
                bookingJson);
    }

    public void savePayment(PaymentResponse payment) {
        if (payment == null || !"SUCCESS".equalsIgnoreCase(payment.getStatus())) {
            return;
        }
        payments.update(
                "INSERT INTO ota_payments (payment_id, booking_id, status, amount, currency) "
                        + "VALUES (?, ?, ?, ?, ?) "
                        + "ON DUPLICATE KEY UPDATE status = VALUES(status), amount = VALUES(amount), currency = VALUES(currency)",
                payment.getPaymentId(),
                payment.getBookingId(),
                payment.getStatus(),
                payment.getAmount(),
                payment.getCurrency());
    }

    public BookingResponse findBooking(OrderQueryRequest query) {
        List<String> rows = orders.query(
                "SELECT booking_json::text FROM ota_orders "
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
