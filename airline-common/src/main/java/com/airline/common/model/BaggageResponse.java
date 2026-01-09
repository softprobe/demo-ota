package com.airline.common.model;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class BaggageResponse {
    private String baggageOrderId;
    private String bookingId;
    private String confirmationNumber;
    private String passengerId;
    private String status; // "SUCCESS", "FAILED", "PENDING_PAYMENT"
    private List<BaggageItem> baggageItems;
    private BigDecimal totalAmount;
    private String currency;
    private LocalDateTime purchaseDate;
    private String paymentStatus;
    private String message;
    private String failureReason; // For failed purchases
    
    @Data
    public static class BaggageItem {
        private String itemId;
        private String baggageType;
        private String description;
        private Integer quantity;
        private BigDecimal unitPrice;
        private BigDecimal totalPrice;
        private String weightLimit; // e.g., "23kg", "32kg"
        private String sizeLimit; // e.g., "158cm total dimensions"
    }
}
