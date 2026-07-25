package org.example.model;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Min;
import java.time.LocalDate;

@Data
public class FlightSearchRequest {
    
    @NotBlank(message = "出发城市不能为空")
    private String fromCity;
    
    @NotBlank(message = "到达城市不能为空")
    private String toCity;
    
    @NotNull(message = "出发日期不能为空")
    private LocalDate departureDate;
    
    @NotBlank(message = "行程类型不能为空")
    private String tripType; // "ONE_WAY", "ROUND_TRIP"
    
    @NotNull(message = "乘客信息不能为空")
    private PassengerInfo passengerInfo;
    
    @NotBlank(message = "舱等不能为空")
    private String cabinClass; // "ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"
    
    @Data
    public static class PassengerInfo {
        @Min(value = 1, message = "成人数量至少为1")
        private int adults = 1;
        
        @Min(value = 0, message = "儿童数量不能为负数")
        private int children = 0;
        
        @Min(value = 0, message = "婴儿数量不能为负数")
        private int infants = 0;
    }
} 