package org.example.model;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
public class ChangeFlightResponse {
    private String changeId;
    private String originalBookingId;
    private String newBookingId;
    private String newConfirmationNumber;
    private String status; // "SUCCESS", "FAILED", "PENDING"
    private FlightInfo originalFlight;
    private FlightInfo newFlight;
    private BigDecimal originalPrice;
    private BigDecimal newPrice;
    private BigDecimal changeFee;
    private BigDecimal priceDifference;
    private BigDecimal totalAdditionalPayment; // changeFee + priceDifference (if positive)
    private String currency;
    private LocalDateTime changeDate;
    private String message;
    private String failureReason; // For failed changes
    
    @Data
    public static class FlightInfo {
        private String flightId;
        private String flightNumber;
        private String departureCity;
        private String arrivalCity;
        private LocalDateTime departureTime;
        private LocalDateTime arrivalTime;
        private String cabinClass;
    }
}
