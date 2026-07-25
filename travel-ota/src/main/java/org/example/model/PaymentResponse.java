package org.example.model;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class PaymentResponse {
    private String paymentId;
    private String pnr;
    private String status; // "SUCCESS", "FAILED", "PENDING"
    private BigDecimal amount;
    private String currency;
    private String paymentMethod;
    private LocalDateTime paymentTime;
    private List<TicketInfo> tickets;
    private String transactionId;
    
    @Data
    public static class TicketInfo {
        private String ticketNumber;
        private String passengerName;
        private String flightNumber;
        private String departureAirport;
        private LocalDateTime departureTime;
        private String arrivalAirport;
        private LocalDateTime arrivalTime;
        private String cabinClass;
    }
} 