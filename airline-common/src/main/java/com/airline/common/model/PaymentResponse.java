package com.airline.common.model;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
public class PaymentResponse {
    private String paymentId;
    private String status; // "SUCCESS", "FAILED", "PENDING", "CANCELLED"
    private String bookingId;
    private BigDecimal amount;
    private String currency;
    private String paymentMethod;
    private LocalDateTime paymentDate;
    private String transactionId;
    private String message;
    private String errorCode;
}
