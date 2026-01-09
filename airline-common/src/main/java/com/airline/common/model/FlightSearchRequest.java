package com.airline.common.model;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Min;
import java.time.LocalDate;

@Data
public class FlightSearchRequest {
    
    @NotBlank(message = "Departure city cannot be empty")
    private String fromCity;
    
    @NotBlank(message = "Arrival city cannot be empty")
    private String toCity;
    
    @NotNull(message = "Departure date cannot be empty")
    private LocalDate departureDate;
    
    @NotBlank(message = "Trip type cannot be empty")
    private String tripType; // "ONE_WAY", "ROUND_TRIP"
    
    @NotNull(message = "Passenger information cannot be empty")
    private PassengerInfo passengerInfo;
    
    @NotBlank(message = "Cabin class cannot be empty")
    private String cabinClass; // "ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"
    
    @Data
    public static class PassengerInfo {
        @Min(value = 1, message = "Number of adults must be at least 1")
        private int adults = 1;
        
        @Min(value = 0, message = "Number of children cannot be negative")
        private int children = 0;
        
        @Min(value = 0, message = "Number of infants cannot be negative")
        private int infants = 0;
    }
}
