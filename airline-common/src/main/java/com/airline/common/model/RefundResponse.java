package com.airline.common.model;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
public class RefundResponse {
    private String refundId;
    private String bookingId;
    private String confirmationNumber;
    private String status; // "SUCCESS", "FAILED", "PENDING"
    private BigDecimal refundAmount;
    private String currency;
    private BigDecimal cancellationFee;
    private BigDecimal netRefundAmount;
    private String refundMethod; // "ORIGINAL_PAYMENT", "BANK_TRANSFER"
    private LocalDateTime refundDate;
    private String message;
    private String failureReason; // For failed refunds
    
    // Estimated days for refund to be processed
    private Integer estimatedRefundDays;
}
