package org.example.model;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class BookingResponse {
    private String bookingId;
    private String status; // "CONFIRMED", "PENDING", "CANCELLED"
    private FlightInfo flightInfo;
    private List<PassengerInfo> passengers;
    private PaymentInfo paymentInfo;
    private LocalDateTime bookingDate;
    private String confirmationNumber;
    
    @Data
    public static class FlightInfo {
        private String flightId;
        private String flightNumber;
        private String departureAirport;
        private String departureCity;
        private LocalDateTime departureTime;
        private String arrivalAirport;
        private String arrivalCity;
        private LocalDateTime arrivalTime;
        private String cabinClass;
    }
    
    @Data
    public static class PassengerInfo {
        private String passengerId;
        private String passengerType; // "ADULT", "CHILD", "INFANT"
        private String firstName;
        private String lastName;
        private String documentType;
        private String documentNumber;
        private String seatNumber;
        private String mealPreference;
    }
    
    @Data
    public static class PaymentInfo {
        private String paymentId;
        private BigDecimal amount;
        private String currency;
        private String paymentMethod;
        private String paymentStatus;
        private LocalDateTime paymentDate;
    }
}
