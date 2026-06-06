package org.example.service;

import com.airline.common.model.*;
import org.example.config.AirlineApiConfig;
import org.example.config.RegionalTaxService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.client.RestClientException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

@Service
public class FlightService {
    private static final Logger logger = LoggerFactory.getLogger(FlightService.class);

    private final Map<String, BookingResponse> bookings = new HashMap<>();
    
    @Autowired
    private RestTemplate restTemplate;
    
    @Autowired
    private AirlineApiConfig airlineApiConfig;

    @Autowired
    private RegionalTaxService regionalTaxService;
    
    // Airline API endpoints
    private static final String FLIGHT_SEARCH_ENDPOINT = "/flights/search";
    private static final String FLIGHT_BOOK_ENDPOINT = "/flights/book";
    private static final String PAYMENT_PROCESS_ENDPOINT = "/payment/process";
    private static final String ORDER_QUERY_ENDPOINT = "/orders/query";
    private static final String REFUND_PROCESS_ENDPOINT = "/refund/process";
    private static final String FLIGHT_CHANGE_ENDPOINT = "/flights/change";
    private static final String BAGGAGE_PURCHASE_ENDPOINT = "/baggage/purchase";
    
    public FlightSearchResponse searchFlights(FlightSearchRequest request) {
        try {
            // Call external airline API
            String url = airlineApiConfig.getBaseUrl() + FLIGHT_SEARCH_ENDPOINT;
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            
            logger.info("AirlineApiConfig baseUrl: {}", airlineApiConfig.getBaseUrl());
            logger.info("Environment AIRLINE_BASE_URL: {}", System.getenv("AIRLINE_BASE_URL"));
            logger.info("Calling airline API for flight search at: {}", url);
            logger.info("Flight search request: {}", request);
            
            HttpEntity<FlightSearchRequest> entity = new HttpEntity<>(request, headers);
            
            ResponseEntity<FlightSearchResponse> response = restTemplate.postForEntity(
                url, entity, FlightSearchResponse.class);
            
            logger.info("Airline API response status: {}", response.getStatusCode());
            
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                FlightSearchResponse flightResponse = response.getBody();
                regionalTaxService.applyToSearchResponse(flightResponse);
                return flightResponse;
            } else {
                logger.error("Airline API returned non-success status: {}", response.getStatusCode());
                throw new RuntimeException("Failed to get response from airline API - Status: " + response.getStatusCode());
            }
        } catch (RestClientException e) {
            // Log error and throw exception - always call external API
            logger.error("Failed to get response from airline API", e);
            throw new RuntimeException("Failed to get response from airline API: " + e.getMessage());
        } catch (Exception e) {
            // Log any other errors
            logger.error("Unexpected error during flight search", e);
            throw new RuntimeException("Unexpected error during flight search: " + e.getMessage());
        }
    }

    public BookingResponse bookFlight(BookingRequest request) {
        try {
            // First, ensure the flight exists in sp-airline by calling searchFlights
            // This populates the flights map in sp-airline service
            FlightSearchRequest searchRequest = new FlightSearchRequest();
            searchRequest.setFromCity("New York");
            searchRequest.setToCity("Los Angeles");
            searchRequest.setDepartureDate(LocalDate.now().plusDays(7));
            searchRequest.setTripType("ONE_WAY");
            searchRequest.setCabinClass("ECONOMY");
            
            FlightSearchRequest.PassengerInfo passengerInfo = new FlightSearchRequest.PassengerInfo();
            passengerInfo.setAdults(request.getPassengers().size());
            searchRequest.setPassengerInfo(passengerInfo);
            
            logger.info("Pre-populating flights in sp-airline service...");
            FlightSearchResponse searchResponse = searchFlights(searchRequest);
            logger.info("Flights pre-populated successfully. Found {} flights", 
                       searchResponse != null ? searchResponse.getFlights().size() : 0);
            
            // Now call external airline API for booking
            String url = airlineApiConfig.getBaseUrl() + FLIGHT_BOOK_ENDPOINT;
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            
            logger.info("Calling airline API at: {}", url);
            logger.info("Booking request: {}", request);
            
            HttpEntity<BookingRequest> entity = new HttpEntity<>(request, headers);
            
            ResponseEntity<BookingResponse> response = restTemplate.postForEntity(
                url, entity, BookingResponse.class);
            
            logger.info("Airline API response status: {}", response.getStatusCode());
            logger.info("Airline API response body: {}", response.getBody());
            
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                BookingResponse bookingResponse = response.getBody();
                
                // Cache the booking for payment reference
                if (bookingResponse.getConfirmationNumber() != null) {
                    bookings.put(bookingResponse.getConfirmationNumber(), bookingResponse);
                }
                
                return bookingResponse;
            } else {
                logger.error("Airline API returned non-success status: {}", response.getStatusCode());
                throw new RuntimeException("Failed to book flight through airline API - Status: " + response.getStatusCode());
            }
        } catch (RestClientException e) {
            // Log error and return 500
            logger.error("Failed to book flight through airline API", e);
            throw new RuntimeException("Failed to book flight through airline API: " + e.getMessage());
        } catch (Exception e) {
            // Log any other errors
            logger.error("Unexpected error during flight booking", e);
            throw new RuntimeException("Unexpected error during flight booking: " + e.getMessage());
        }
    }

    public PaymentResponse payAndIssue(PaymentRequest request) {
        try {
            // Call external airline API for payment processing
            String url = airlineApiConfig.getBaseUrl() + PAYMENT_PROCESS_ENDPOINT;
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            
            logger.info("Calling airline API for payment at: {}", url);
            logger.info("Payment request: {}", request);
            
            HttpEntity<PaymentRequest> entity = new HttpEntity<>(request, headers);
            
            ResponseEntity<PaymentResponse> response = restTemplate.postForEntity(
                url, entity, PaymentResponse.class);
            
            logger.info("Airline API payment response status: {}", response.getStatusCode());
            logger.info("Airline API payment response body: {}", response.getBody());
            
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                return response.getBody();
            } else {
                logger.error("Airline API payment returned non-success status: {}", response.getStatusCode());
                throw new RuntimeException("Failed to process payment through airline API - Status: " + response.getStatusCode());
            }
        } catch (RestClientException e) {
            // Log error and return 500
            logger.error("Failed to process payment through airline API", e);
            throw new RuntimeException("Failed to process payment through airline API: " + e.getMessage());
        } catch (Exception e) {
            // Log any other errors
            logger.error("Unexpected error during payment processing", e);
            throw new RuntimeException("Unexpected error during payment processing: " + e.getMessage());
        }
    }

    // ==================== ORDER MANAGEMENT ====================
    
    public BookingResponse queryOrder(OrderQueryRequest request) {
        try {
            String url = airlineApiConfig.getBaseUrl() + ORDER_QUERY_ENDPOINT;
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            
            logger.info("Calling airline API for order query at: {}", url);
            logger.info("Order query request: {}", request);
            
            HttpEntity<OrderQueryRequest> entity = new HttpEntity<>(request, headers);
            
            ResponseEntity<BookingResponse> response = restTemplate.postForEntity(
                url, entity, BookingResponse.class);
            
            logger.info("Airline API response status: {}", response.getStatusCode());
            
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                return response.getBody();
            } else {
                logger.error("Airline API returned non-success status: {}", response.getStatusCode());
                throw new RuntimeException("Failed to query order from airline API");
            }
        } catch (RestClientException e) {
            logger.error("Failed to query order from airline API", e);
            throw new RuntimeException("Failed to query order from airline API: " + e.getMessage());
        } catch (Exception e) {
            logger.error("Unexpected error during order query", e);
            throw new RuntimeException("Unexpected error during order query: " + e.getMessage());
        }
    }

    // ==================== REFUND FUNCTIONALITY ====================
    
    public RefundResponse processRefund(RefundRequest request) {
        try {
            String url = airlineApiConfig.getBaseUrl() + REFUND_PROCESS_ENDPOINT;
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            
            logger.info("Calling airline API for refund at: {}", url);
            logger.info("Refund request: {}", request);
            
            HttpEntity<RefundRequest> entity = new HttpEntity<>(request, headers);
            
            ResponseEntity<RefundResponse> response = restTemplate.postForEntity(
                url, entity, RefundResponse.class);
            
            logger.info("Airline API refund response status: {}", response.getStatusCode());
            logger.info("Airline API refund response body: {}", response.getBody());
            
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                return response.getBody();
            } else {
                logger.error("Airline API refund returned non-success status: {}", response.getStatusCode());
                throw new RuntimeException("Failed to process refund through airline API");
            }
        } catch (RestClientException e) {
            logger.error("Failed to process refund through airline API", e);
            throw new RuntimeException("Failed to process refund through airline API: " + e.getMessage());
        } catch (Exception e) {
            logger.error("Unexpected error during refund processing", e);
            throw new RuntimeException("Unexpected error during refund processing: " + e.getMessage());
        }
    }

    // ==================== FLIGHT CHANGE FUNCTIONALITY ====================
    
    public ChangeFlightResponse changeFlight(ChangeFlightRequest request) {
        try {
            // First, search for available flights to ensure the new flight exists
            if (request.getNewDepartureCity() != null && request.getNewArrivalCity() != null) {
                FlightSearchRequest searchRequest = new FlightSearchRequest();
                searchRequest.setFromCity(request.getNewDepartureCity());
                searchRequest.setToCity(request.getNewArrivalCity());
                searchRequest.setDepartureDate(request.getNewDepartureDate() != null ? 
                    request.getNewDepartureDate() : LocalDate.now().plusDays(1));
                searchRequest.setTripType("ONE_WAY");
                searchRequest.setCabinClass("ECONOMY");
                
                FlightSearchRequest.PassengerInfo passengerInfo = new FlightSearchRequest.PassengerInfo();
                passengerInfo.setAdults(1);
                searchRequest.setPassengerInfo(passengerInfo);
                
                logger.info("Pre-searching flights for change operation...");
                searchFlights(searchRequest);
            }
            
            // Now call airline API for flight change
            String url = airlineApiConfig.getBaseUrl() + FLIGHT_CHANGE_ENDPOINT;
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            
            logger.info("Calling airline API for flight change at: {}", url);
            logger.info("Flight change request: {}", request);
            
            HttpEntity<ChangeFlightRequest> entity = new HttpEntity<>(request, headers);
            
            ResponseEntity<ChangeFlightResponse> response = restTemplate.postForEntity(
                url, entity, ChangeFlightResponse.class);
            
            logger.info("Airline API change response status: {}", response.getStatusCode());
            logger.info("Airline API change response body: {}", response.getBody());
            
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                return response.getBody();
            } else {
                logger.error("Airline API change returned non-success status: {}", response.getStatusCode());
                throw new RuntimeException("Failed to change flight through airline API");
            }
        } catch (RestClientException e) {
            logger.error("Failed to change flight through airline API", e);
            throw new RuntimeException("Failed to change flight through airline API: " + e.getMessage());
        } catch (Exception e) {
            logger.error("Unexpected error during flight change", e);
            throw new RuntimeException("Unexpected error during flight change: " + e.getMessage());
        }
    }

    // ==================== BAGGAGE PURCHASE FUNCTIONALITY ====================
    
    public BaggageResponse purchaseBaggage(BaggageRequest request) {
        try {
            String url = airlineApiConfig.getBaseUrl() + BAGGAGE_PURCHASE_ENDPOINT;
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            
            logger.info("Calling airline API for baggage purchase at: {}", url);
            logger.info("Baggage purchase request: {}", request);
            
            HttpEntity<BaggageRequest> entity = new HttpEntity<>(request, headers);
            
            ResponseEntity<BaggageResponse> response = restTemplate.postForEntity(
                url, entity, BaggageResponse.class);
            
            logger.info("Airline API baggage response status: {}", response.getStatusCode());
            logger.info("Airline API baggage response body: {}", response.getBody());
            
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                return response.getBody();
            } else {
                logger.error("Airline API baggage returned non-success status: {}", response.getStatusCode());
                throw new RuntimeException("Failed to purchase baggage through airline API");
            }
        } catch (RestClientException e) {
            logger.error("Failed to purchase baggage through airline API", e);
            throw new RuntimeException("Failed to purchase baggage through airline API: " + e.getMessage());
        } catch (Exception e) {
            logger.error("Unexpected error during baggage purchase", e);
            throw new RuntimeException("Unexpected error during baggage purchase: " + e.getMessage());
        }
    }
}