package org.example.service;

import org.example.model.BookingResponse;
import org.example.model.OrderQueryRequest;
import org.example.model.PaymentResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
class TravelDatabaseServiceTest {

    @Autowired
    private TravelDatabaseService database;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void embeddedDatabaseStartsWithSchemaAndStoresBookings() {
        BookingResponse booking = new BookingResponse();
        booking.setBookingId("embedded-booking-1");
        booking.setConfirmationNumber("H2TEST1");
        BookingResponse.PassengerInfo passenger = new BookingResponse.PassengerInfo();
        passenger.setLastName("Tester");
        booking.setPassengers(List.of(passenger));

        database.saveBooking(booking);

        OrderQueryRequest query = new OrderQueryRequest();
        query.setConfirmationNumber("H2TEST1");
        query.setPassengerLastName("Tester");
        BookingResponse stored = database.findBooking(query);

        assertEquals("embedded-booking-1", stored.getBookingId());
        assertEquals("Tester", stored.getPassengers().get(0).getLastName());
    }

    @Test
    void successfulPaymentsUpsertAndFailedPaymentsAreIgnored() {
        PaymentResponse payment = new PaymentResponse();
        payment.setPaymentId("h2-payment-1");
        payment.setBookingId("embedded-booking-1");
        payment.setStatus("SUCCESS");
        payment.setAmount(new BigDecimal("125.00"));
        payment.setCurrency("USD");
        database.savePayment(payment);

        payment.setAmount(new BigDecimal("130.00"));
        database.savePayment(payment);

        PaymentResponse failed = new PaymentResponse();
        failed.setPaymentId("h2-payment-failed");
        failed.setBookingId("embedded-booking-1");
        failed.setStatus("FAILED");
        failed.setAmount(new BigDecimal("99.00"));
        failed.setCurrency("USD");
        database.savePayment(failed);

        assertEquals(1, jdbc.queryForObject(
                "SELECT COUNT(*) FROM ota_payments WHERE payment_id = ?",
                Integer.class,
                "h2-payment-1"));
        assertEquals(new BigDecimal("130.00"), jdbc.queryForObject(
                "SELECT amount FROM ota_payments WHERE payment_id = ?",
                BigDecimal.class,
                "h2-payment-1"));
        assertEquals(0, jdbc.queryForObject(
                "SELECT COUNT(*) FROM ota_payments WHERE payment_id = ?",
                Integer.class,
                "h2-payment-failed"));
    }
}
