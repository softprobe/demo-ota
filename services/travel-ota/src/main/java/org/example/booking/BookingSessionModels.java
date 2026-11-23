package org.example.booking;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.math.BigDecimal;
import java.util.List;

public final class BookingSessionModels {

    private BookingSessionModels() {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TravelPolicy(
            String policyId,
            String ruleId,
            String policyVersion,
            String name,
            int threshold,
            String currency,
            String text) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SessionOffer(
            String id,
            String offerId,
            String flightId,
            String fareId,
            String airlineName,
            String flightNumber,
            String origin,
            String destination,
            String date,
            String departureTime,
            String arrivalTime,
            BigDecimal total,
            String currency,
            String cabinClass,
            String fareBrand) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PassengerName(String firstName, String lastName) {}

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record ManagerApproval(
            String policyId,
            String ruleId,
            String policyVersion,
            int threshold,
            String currency,
            String status,
            String requestedAt) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record DemoFault(String kind, String enabledAt) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record VerifiedFlightInfo(
            String flightId,
            String flightNumber,
            String departureAirport,
            String departureCity,
            String departureTime,
            String arrivalAirport,
            String arrivalCity,
            String arrivalTime,
            String cabinClass) {}

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record VerifiedPaymentInfo(
            String paymentId,
            String paymentMethod,
            String paymentStatus,
            String paymentDate) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PaymentAttemptSummary(String status) {}

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record VerifiedPaymentDetail(
            String paymentId,
            String transactionId,
            String status,
            String bookingId,
            BigDecimal amount,
            String currency,
            String paymentMethod,
            String paymentDate,
            String apiStatus,
            String apiMessage,
            boolean apiResponseVerified) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record VerifiedBooking(
            String bookingId,
            String confirmationNumber,
            String status,
            String paymentStatus,
            Boolean verified,
            VerifiedFlightInfo flightInfo,
            BigDecimal amount,
            String currency,
            PassengerName passenger,
            VerifiedPaymentInfo paymentInfo,
            ManagerApproval managerApproval,
            DemoFault demoFault,
            PaymentAttemptSummary paymentAttempt,
            VerifiedPaymentDetail payment) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PaymentExecutionResult(VerifiedPaymentDetail payment, VerifiedBooking booking) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PendingPaymentState(String status, PaymentExecutionResult result) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PendingReview(
            String id,
            String status,
            SessionOffer offer,
            PassengerName passenger,
            long expiresAt,
            ManagerApproval managerApproval,
            DemoFault demoFault,
            VerifiedBooking result,
            PendingPaymentState payment) {}

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record BookingSessionView(
            String sessionId,
            List<SessionOffer> offers,
            PendingReview pending,
            VerifiedBooking booking,
            TravelPolicy travelPolicy) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SearchToolResponse(List<SessionOffer> offers, String constraints) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ApproveResponse(boolean accepted, boolean awaitingManagerApproval, PendingReview pending) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PayResponse(boolean paid, VerifiedBooking booking) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CancelResponse(boolean cancelled, PendingReview pending) {}
}
