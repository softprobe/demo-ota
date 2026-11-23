package org.example.service;

import org.example.config.RegionalTaxService;
import org.example.model.*;
import org.example.ndc.NdcAirlineClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
public class FlightService {
    private static final Logger logger = LoggerFactory.getLogger(FlightService.class);

    @Autowired
    private NdcAirlineClient ndcAirlineClient;

    @Autowired
    private RegionalTaxService regionalTaxService;

    @Autowired
    private OtaPersistenceService otaPersistenceService;

    @Autowired
    private DownstreamGatewayClient downstreamGatewayClient;

    public FlightSearchResponse searchFlights(FlightSearchRequest request) {
        try {
            long priorOrders = otaPersistenceService.countOrdersForRoute(
                    request.getFromCity(), request.getToCity());
            logger.warn(
                    "searching flights: departure {}, arrival {}, date {}, existingRouteOrders {}",
                    request.getFromCity(),
                    request.getToCity(),
                    request.getDepartureDate(),
                    priorOrders);
            FlightSearchResponse flightResponse = ndcAirlineClient.searchFlights(request);
            regionalTaxService.applyToSearchResponse(flightResponse);
            return flightResponse;
        } catch (Exception e) {
            logger.error("Failed to get response from airline NDC API", e);
            throw new RuntimeException("Failed to get response from airline API: " + e.getMessage(), e);
        }
    }

    public BookingResponse bookFlight(BookingRequest request) {
        try {
            logger.warn(
                    "booking flight: flightId {}, fareId {}, passengers {}",
                    request.getFlightId(),
                    request.getFareId(),
                    request.getPassengers().size());
            BookingResponse bookingResponse = ndcAirlineClient.bookFlight(request);
            otaPersistenceService.upsertOrderFromBooking(request, bookingResponse);
            String recipientEmail = request.getContactInfo() != null ? request.getContactInfo().getEmail() : null;
            String confirmation = bookingResponse.getConfirmationNumber() != null
                    ? bookingResponse.getConfirmationNumber()
                    : bookingResponse.getBookingId();
            downstreamGatewayClient.sendConfirmationIfEnabled(
                    bookingResponse.getBookingId(),
                    confirmation,
                    recipientEmail,
                    "BOOKING_CONFIRMED");
            return bookingResponse;
        } catch (Exception e) {
            logger.error("Failed to book flight", e);
            throw new RuntimeException("Failed to book flight through airline API: " + e.getMessage(), e);
        }
    }

    public PaymentResponse payAndIssue(PaymentRequest request) {
        try {
            logger.warn(
                    "processing payment: bookingId {}, amount {} {}",
                    request.getBookingId(),
                    request.getAmount(),
                    request.getCurrency());
            String cardLast4 = extractCardLast4(request);
            DownstreamGatewayClient.PaymentAuthorization auth = downstreamGatewayClient.authorizePayment(
                    request.getBookingId(),
                    request.getAmount(),
                    request.getCurrency(),
                    request.getPaymentMethod(),
                    cardLast4);
            PaymentResponse paymentResponse = ndcAirlineClient.payAndIssue(request);
            otaPersistenceService.recordPayment(
                    request,
                    paymentResponse,
                    auth != null ? auth.authorizationId() : null);
            Optional<OtaPersistenceService.OrderSummary> orderSummary =
                    otaPersistenceService.findOrderByBookingId(request.getBookingId());
            String confirmation = orderSummary
                    .map(OtaPersistenceService.OrderSummary::confirmationNumber)
                    .filter(val -> val != null && !val.isBlank())
                    .orElse(request.getBookingId());
            String recipientEmail = orderSummary
                    .map(OtaPersistenceService.OrderSummary::contactEmail)
                    .orElse(null);
            downstreamGatewayClient.sendConfirmationIfEnabled(
                    request.getBookingId(),
                    confirmation,
                    recipientEmail,
                    "TICKET_ISSUED");
            return paymentResponse;
        } catch (Exception e) {
            logger.error("Failed to process payment", e);
            throw new RuntimeException("Failed to process payment through airline API: " + e.getMessage(), e);
        }
    }

    public BookingResponse queryOrder(OrderQueryRequest request) {
        try {
            otaPersistenceService.findOrderByConfirmation(request.getConfirmationNumber());
            BookingResponse response = ndcAirlineClient.queryOrder(request);
            otaPersistenceService.upsertOrderSnapshot(response);
            return response;
        } catch (Exception e) {
            logger.error("Failed to query order from airline NDC API", e);
            throw new RuntimeException("Failed to query order from airline API: " + e.getMessage(), e);
        }
    }

    public RefundResponse processRefund(RefundRequest request) {
        try {
            otaPersistenceService.findOrderByBookingId(request.getBookingId());
            RefundResponse response = ndcAirlineClient.processRefund(request);
            if ("SUCCESS".equalsIgnoreCase(response.getStatus())) {
                otaPersistenceService.markOrderRefunded(request.getBookingId());
            }
            return response;
        } catch (Exception e) {
            logger.error("Failed to process refund through airline NDC API", e);
            throw new RuntimeException("Failed to process refund through airline API: " + e.getMessage(), e);
        }
    }

    public ChangeFlightResponse changeFlight(ChangeFlightRequest request) {
        try {
            otaPersistenceService.findOrderByBookingId(request.getOriginalBookingId());
            ChangeFlightResponse response = ndcAirlineClient.changeFlight(request);
            if ("SUCCESS".equalsIgnoreCase(response.getStatus())) {
                otaPersistenceService.recordFlightChange(request, response);
            }
            return response;
        } catch (Exception e) {
            logger.error("Failed to change flight through airline NDC API", e);
            throw new RuntimeException("Failed to change flight through airline API: " + e.getMessage(), e);
        }
    }

    public BaggageResponse purchaseBaggage(BaggageRequest request) {
        try {
            otaPersistenceService.findOrderByBookingId(request.getBookingId());
            BaggageResponse response = ndcAirlineClient.purchaseBaggage(request);
            otaPersistenceService.touchOrderBaggage(request.getBookingId());
            return response;
        } catch (Exception e) {
            logger.error("Failed to purchase baggage through airline NDC API", e);
            throw new RuntimeException("Failed to purchase baggage through airline API: " + e.getMessage(), e);
        }
    }

    private static String extractCardLast4(PaymentRequest request) {
        if (request.getPaymentDetails() == null || request.getPaymentDetails().getCardNumber() == null) {
            return null;
        }
        String digits = request.getPaymentDetails().getCardNumber().replaceAll("\\s+", "");
        return digits.length() >= 4 ? digits.substring(digits.length() - 4) : null;
    }
}
