package com.airline.common.model;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fasterxml.jackson.databind.deser.std.NumberDeserializers;

@Data
public class PaymentRequest {
    
    @NotBlank(message = "Booking ID cannot be empty")
    private String bookingId;
    
    @NotBlank(message = "Payment method cannot be empty")
    private String paymentMethod; // "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "DIGITAL_WALLET"
    
    @NotNull(message = "Amount cannot be empty")
    @DecimalMin(value = "0.01", message = "Amount must be greater than 0")
    private BigDecimal amount;
    
    @NotBlank(message = "Currency cannot be empty")
    private String currency;
    
    @NotNull(message = "Payment details cannot be empty")
    private PaymentDetails paymentDetails;
    
    @Data
    public static class PaymentDetails {
        @NotBlank(message = "Card number cannot be empty")
        private String cardNumber;
        
        @NotBlank(message = "Card holder name cannot be empty")
        private String cardHolderName;
        
        @NotBlank(message = "Expiry date cannot be empty")
        private String expiryDate;
        
        @NotBlank(message = "CVV cannot be empty")
        private String cvv;
        
        private String billingAddress;
        private String billingCity;
        private String billingCountry;
        private String billingPostalCode;
    }
}
