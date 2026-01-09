package com.airline.sp.model;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

@Data
public class PaymentRequest {
    
    @NotBlank(message = "PNR cannot be empty")
    private String pnr;
    
    @NotNull(message = "Amount cannot be null")
    private BigDecimal amount;
    
    @NotBlank(message = "Currency cannot be empty")
    private String currency;
    
    @NotBlank(message = "Payment method cannot be empty")
    private String paymentMethod;
    
    @NotBlank(message = "Card number cannot be empty")
    private String cardNumber;
    
    @NotBlank(message = "Card holder name cannot be empty")
    private String cardHolderName;
    
    @NotBlank(message = "Expiry date cannot be empty")
    private String expiryDate;
    
    @NotBlank(message = "CVV cannot be empty")
    private String cvv;
}
