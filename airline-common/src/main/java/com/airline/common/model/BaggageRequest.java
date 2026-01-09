package com.airline.common.model;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

@Data
public class BaggageRequest {
    
    @NotBlank(message = "Booking ID cannot be empty")
    private String bookingId;
    
    @NotBlank(message = "Confirmation number cannot be empty")
    private String confirmationNumber;
    
    @NotBlank(message = "Passenger last name cannot be empty")
    private String passengerLastName;
    
    @NotBlank(message = "Passenger ID cannot be empty")
    private String passengerId;
    
    @NotNull(message = "Number of additional bags cannot be null")
    @Positive(message = "Number of additional bags must be positive")
    private Integer additionalBags;
    
    @NotBlank(message = "Baggage type cannot be empty")
    private String baggageType; // "CHECKED", "OVERWEIGHT", "OVERSIZED", "SPORTS_EQUIPMENT"
    
    // For sports equipment or special baggage
    private String equipmentType; // "GOLF", "BICYCLE", "SKIS", "SURFBOARD"
    
    private String specialRequirements;
}
