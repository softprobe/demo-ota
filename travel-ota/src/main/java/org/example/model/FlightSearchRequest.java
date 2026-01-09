package org.example.model;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Min;
import java.time.LocalDate;

@Data
public class FlightSearchRequest {
    
    @NotBlank(message = "Departure city is required")
    private String fromCity;
    
    @NotBlank(message = "Arrival city is required")
    private String toCity;
    
    @NotNull(message = "Departure date is required")
    private LocalDate departureDate;
    
    @NotBlank(message = "Trip type is required")
    private String tripType; // "ONE_WAY", "ROUND_TRIP"
    
    @NotNull(message = "Passenger information is required")
    private PassengerInfo passengerInfo;
    
    @NotBlank(message = "Cabin class is required")
    private String cabinClass; // "ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"
    
    @Data
    public static class PassengerInfo {
        @Min(value = 1, message = "Adults must be at least 1")
        private int adults = 1;
        
        @Min(value = 0, message = "Children cannot be negative")
        private int children = 0;
        
        @Min(value = 0, message = "Infants cannot be negative")
        private int infants = 0;
    }
} 
