package org.example.model;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

@Data
public class PaymentRequest {
    
    @NotBlank(message = "PNR is required")
    private String pnr;
    
    @NotBlank(message = "Payment method is required")
    private String paymentMethod; // "CREDIT_CARD", "DEBIT_CARD", "ALIPAY", "WECHAT"
    
    @NotNull(message = "Payment amount is required")
    private PaymentInfo paymentInfo;
    
    @Data
    public static class PaymentInfo {
        @NotBlank(message = "Card number is required")
        private String cardNumber;
        
        @NotBlank(message = "Card holder name is required")
        private String cardHolderName;
        
        @NotBlank(message = "Expiry month is required")
        private String expiryMonth;
        
        @NotBlank(message = "Expiry year is required")
        private String expiryYear;
        
        @NotBlank(message = "CVV is required")
        private String cvv;
        
        private String billingAddress;
    }
} 