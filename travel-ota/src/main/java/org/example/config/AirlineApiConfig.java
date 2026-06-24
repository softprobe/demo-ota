package org.example.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

@Data
@Component
@Primary
@ConfigurationProperties(prefix = "app.airline")
public class AirlineApiConfig {
    
    /**
     * Airline service base URL.
     */
    private String baseUrl;
    
    /**
     * Connection timeout (milliseconds).
     */
    private int connectionTimeout = 5000;
    
    /**
     * Read timeout (milliseconds).
     */
    private int readTimeout = 10000;
}

