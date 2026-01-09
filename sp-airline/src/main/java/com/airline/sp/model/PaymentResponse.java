package com.airline.sp.model;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class PaymentResponse {
    private String paymentId;
    private String pnr;
    private String status;
    private BigDecimal amount;
    private String currency;
    private String paymentMethod;
    private LocalDateTime paymentTime;
    private String transactionId;
    private List<TicketInfo> tickets;
    
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
