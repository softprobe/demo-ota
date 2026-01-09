package com.airline.common.model;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;

@Data
public class OrderQueryRequest {
    
    @NotBlank(message = "Confirmation number cannot be empty")
    private String confirmationNumber;
    
    @NotBlank(message = "Passenger last name cannot be empty")
    private String passengerLastName;
}
