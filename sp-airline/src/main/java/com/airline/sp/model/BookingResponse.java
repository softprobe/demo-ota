package com.airline.sp.model;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class BookingResponse {
    private String bookingId;
    private String pnr;
    private String status;
    private LocalDateTime bookingTime;
    private LocalDateTime expiryTime;
    private String contactName;
    private BigDecimal totalAmount;
    private String currency;
    private FlightInfo flightInfo;
    private List<Passenger> passengers;

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

    @Data
    public static class Passenger {
        private String firstName;
        private String lastName;
        private String passportNumber;
        private String dateOfBirth;
        private String nationality;
    }
}
