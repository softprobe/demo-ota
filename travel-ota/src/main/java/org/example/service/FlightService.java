package org.example.service;

import org.example.model.*;
import org.example.config.RegionalTaxService;
import org.example.ndc.NdcAirlineClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class FlightService {
    private static final Logger logger = LoggerFactory.getLogger(FlightService.class);

    private final Map<String, BookingResponse> bookings = new HashMap<>();

    @Autowired
    private NdcAirlineClient ndcAirlineClient;

    @Autowired
    private RegionalTaxService regionalTaxService;

    public FlightSearchResponse searchFlights(FlightSearchRequest request) {
        try {
            logger.warn(
                    "searching flights: departure {}, arrival {}, date {}",
                    request.getFromCity(),
                    request.getToCity(),
                    request.getDepartureDate());
            logger.info("Calling airline NDC API for flight search");
            FlightSearchResponse flightResponse = ndcAirlineClient.searchFlights(request);
            regionalTaxService.applyToSearchResponse(flightResponse);
            return flightResponse;
        } catch (Exception e) {
            logger.error("Failed to get response from airline NDC API", e);
            throw new RuntimeException("Failed to get response from airline API: " + e.getMessage());
        }
    }

    public BookingResponse bookFlight(BookingRequest request) {
        try {
            logger.warn(
                    "booking flight: flightId {}, fareId {}, passengers {}",
                    request.getFlightId(),
                    request.getFareId(),
                    request.getPassengers().size());
            logger.info("Calling airline NDC API for booking");
            BookingResponse bookingResponse = ndcAirlineClient.bookFlight(request);
            if (bookingResponse.getConfirmationNumber() != null) {
                bookings.put(bookingResponse.getConfirmationNumber(), bookingResponse);
            }
            return bookingResponse;
        } catch (Exception e) {
            logger.error("Failed to book flight through airline NDC API", e);
            throw new RuntimeException("Failed to book flight through airline API: " + e.getMessage());
        }
    }

    public PaymentResponse payAndIssue(PaymentRequest request) {
        try {
            logger.warn(
                    "processing payment: bookingId {}, amount {} {}",
                    request.getBookingId(),
                    request.getAmount(),
                    request.getCurrency());
            logger.info("Calling airline NDC API for payment");
            return ndcAirlineClient.payAndIssue(request);
        } catch (Exception e) {
            logger.error("Failed to process payment through airline NDC API", e);
            throw new RuntimeException("Failed to process payment through airline API: " + e.getMessage());
        }
    }

    public BookingResponse queryOrder(OrderQueryRequest request) {
        try {
            logger.info("Calling airline NDC API for order query");
            return ndcAirlineClient.queryOrder(request);
        } catch (Exception e) {
            logger.error("Failed to query order from airline NDC API", e);
            throw new RuntimeException("Failed to query order from airline API: " + e.getMessage());
        }
    }

    public RefundResponse processRefund(RefundRequest request) {
        try {
            logger.info("Calling airline NDC API for refund");
            return ndcAirlineClient.processRefund(request);
        } catch (Exception e) {
            logger.error("Failed to process refund through airline NDC API", e);
            throw new RuntimeException("Failed to process refund through airline API: " + e.getMessage());
        }
    }

    public ChangeFlightResponse changeFlight(ChangeFlightRequest request) {
        try {
            logger.info("Calling airline NDC API for flight change");
            return ndcAirlineClient.changeFlight(request);
        } catch (Exception e) {
            logger.error("Failed to change flight through airline NDC API", e);
            throw new RuntimeException("Failed to change flight through airline API: " + e.getMessage());
        }
    }

    public BaggageResponse purchaseBaggage(BaggageRequest request) {
        try {
            logger.info("Calling airline NDC API for baggage purchase");
            return ndcAirlineClient.purchaseBaggage(request);
        } catch (Exception e) {
            logger.error("Failed to purchase baggage through airline NDC API", e);
            throw new RuntimeException("Failed to purchase baggage through airline API: " + e.getMessage());
        }
    }
}
