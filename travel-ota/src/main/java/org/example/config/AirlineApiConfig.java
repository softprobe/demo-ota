package org.example.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "app.airline")
public class AirlineApiConfig {
    
    /**
     * 航空公司服务基础URL
     */
    private String baseUrl;
    
    /**
     * 连接超时时间（毫秒）
     */
    private int connectionTimeout = 5000;
    
    /**
     * 读取超时时间（毫秒）
     */
    private int readTimeout = 10000;
}


