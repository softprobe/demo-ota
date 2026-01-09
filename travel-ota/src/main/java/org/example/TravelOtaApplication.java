package org.example;

import org.example.config.AirlineApiConfig;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(AirlineApiConfig.class)
public class TravelOtaApplication {

    public static void main(String[] args) {
        SpringApplication.run(TravelOtaApplication.class, args);
    }
    

}