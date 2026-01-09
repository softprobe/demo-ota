package com.airline.common.model;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import java.time.LocalDate;

@Data
public class ChangeFlightRequest {
    
    @NotBlank(message = "Original booking ID cannot be empty")
    private String originalBookingId;
    
    @NotBlank(message = "Confirmation number cannot be empty")
    private String confirmationNumber;
    
    @NotBlank(message = "New flight ID cannot be empty")
    private String newFlightId;
    
    @NotBlank(message = "New fare ID cannot be empty")
    private String newFareId;
    
    @NotBlank(message = "Change reason cannot be empty")
    private String changeReason; // "SCHEDULE_CHANGE", "PERSONAL_REASON", "EMERGENCY"
    
    private String reasonDetails;
    
    @NotBlank(message = "Passenger last name cannot be empty")
    private String passengerLastName;
    
    // New flight search criteria (for validation)
    private String newDepartureCity;
    private String newArrivalCity;
    private LocalDate newDepartureDate;
}
