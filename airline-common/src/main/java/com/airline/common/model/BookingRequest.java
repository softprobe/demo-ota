package com.airline.common.model;

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
    
    @NotNull(message = "Contact information cannot be empty")
    private ContactInfo contactInfo;
    
    @Data
    public static class Passenger {
        @NotBlank(message = "Passenger type cannot be empty")
        private String passengerType; // "ADULT", "CHILD", "INFANT"
        
        @NotBlank(message = "First name cannot be empty")
        private String firstName;
        
        @NotBlank(message = "Last name cannot be empty")
        private String lastName;
        
        @NotBlank(message = "Document type cannot be empty")
        private String documentType; // "PASSPORT", "ID_CARD"
        
        @NotBlank(message = "Document number cannot be empty")
        private String documentNumber;
        
        private String dateOfBirth; // Optional, for children and infants
        
        @NotBlank(message = "Nationality cannot be empty")
        private String nationality;
    }
    
    @Data
    public static class ContactInfo {
        @NotBlank(message = "Phone number cannot be empty")
        private String phone;
        
        @NotBlank(message = "Email cannot be empty")
        private String email;
        
        private String address;
    }
}
