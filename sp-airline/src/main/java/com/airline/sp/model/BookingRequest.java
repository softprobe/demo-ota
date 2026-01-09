package com.airline.sp.model;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

@Data
public class BookingRequest {
    
    @NotBlank(message = "Flight ID cannot be empty")
    private String flightId;
    
    @NotBlank(message = "Fare ID cannot be empty")
    private String fareId;
    
    @NotEmpty(message = "Passengers list cannot be empty")
    private List<Passenger> passengers;
    
    @NotBlank(message = "Contact information cannot be empty")
    private String contactInfo;
    
    @Data
    public static class Passenger {
        @NotBlank(message = "First name cannot be empty")
        private String firstName;
        
        @NotBlank(message = "Last name cannot be empty")
        private String lastName;
        
        @NotBlank(message = "Passport number cannot be empty")
        private String passportNumber;
        
        @NotBlank(message = "Date of birth cannot be empty")
        private String dateOfBirth;
        
        @NotBlank(message = "Nationality cannot be empty")
        private String nationality;
    }
}
