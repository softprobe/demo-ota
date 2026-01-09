package com.airline.common.model;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import java.math.BigDecimal;

@Data
public class RefundRequest {
    
    @NotBlank(message = "Booking ID cannot be empty")
    private String bookingId;
    
    @NotBlank(message = "Confirmation number cannot be empty")
    private String confirmationNumber;
    
    @NotBlank(message = "Refund reason cannot be empty")
    private String refundReason; // "SCHEDULE_CHANGE", "PERSONAL_REASON", "EMERGENCY", "OTHER"
    
    private String reasonDetails;
    
    @NotBlank(message = "Passenger last name cannot be empty")
    private String passengerLastName;
    
    // For partial refund - if empty, refund all passengers
    private java.util.List<String> passengerIds;
}
