package org.example.model;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
public class BookingResponse {
    private String bookingId;
    private String pnr;
    private String status; // "CONFIRMED", "PENDING", "FAILED"
    private BigDecimal totalAmount;
    private String currency;
    private FlightInfo flightInfo;
    private LocalDateTime bookingTime;
    private LocalDateTime expiryTime; // Booking expiration time
    private String contactName;
    
    @Data
    public static class FlightInfo {
        private String flightNumber;
        private String airlineName;
        private String departureAirport;
        private String departureCity;
        private LocalDateTime departureTime;
        private String arrivalAirport;
        private String arrivalCity;
        private LocalDateTime arrivalTime;
        private String cabinClass;
    }
} 
