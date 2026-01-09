package org.example.model;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class FlightSearchResponse {
    private List<FlightOption> flights;
    private SearchSummary summary;
    
    @Data
    public static class FlightOption {
        private String flightId;
        private String airlineCode;
        private String airlineName;
        private String flightNumber;
        private String departureAirport;
        private String departureCity;
        private LocalDateTime departureTime;
        private String arrivalAirport;
        private String arrivalCity;
        private LocalDateTime arrivalTime;
        private int durationMinutes;
        private String flightType; // "DIRECT", "ONE_STOP", "MULTI_STOP"
        private List<FareOption> fareOptions;
        private boolean hasWifi;
        private boolean hasPowerOutlet;
        private String co2Emission; // Emissions info
    }
    
    @Data
    public static class FareOption {
        private String fareId;
        private String providerName;
        private BigDecimal price;
        private String currency;
        private String cabinClass;
        private BaggageInfo baggageInfo;
        private int rating;
        private int reviewCount;
        private boolean isRecommended;
        private String paymentOption; // "VISA", "MASTERCARD", etc.
        private String fareBrand; // "Basic", "Standard", "Flex", "Premium"
        private String description; // Fare description
    }
    
    @Data
    public static class BaggageInfo {
        private int cabinBags;
        private int checkedBags;
        private boolean cabinBagIncluded;
        private boolean checkedBagIncluded;
    }
    
    @Data
    public static class SearchSummary {
        private int totalResults;
        private BigDecimal lowestPrice;
        private BigDecimal highestPrice;
        private String sortBy;
        private List<DatePrice> datePrices;
    }
    
    @Data
    public static class DatePrice {
        private String date;
        private BigDecimal minPrice;
        private boolean isSelected;
    }
} 
