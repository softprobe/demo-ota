package org.example.model;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;

@Data
public class BookingRequest {
    
    @NotBlank(message = "FareId cannot be empty")
    private String fareId;
    
    @NotBlank(message = "FlightId cannot be empty")
    private String flightId;
    
    @NotNull(message = "Passengers cannot be empty")
    private List<PassengerDetail> passengers;
    
    @NotNull(message = "ContactInfo cannot be empty")
    private ContactInfo contactInfo;
    
    @Data
    public static class PassengerDetail {
        @NotBlank(message = "Passenger type cannot be empty")
        private String passengerType; // "ADULT", "CHILD", "INFANT"
        
        @NotBlank(message = "Last name cannot be empty")
        private String lastName;
        
        @NotBlank(message = "First name cannot be empty")
        private String firstName;
        
        @NotBlank(message = "Document type cannot be empty")
        private String documentType; // "PASSPORT", "ID_CARD"
        
        @NotBlank(message = "Document number cannot be empty")
        private String documentNumber;
        
        private String dateOfBirth; // Optional, for children and infants
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