package com.airline.sp.service;

import com.airline.common.model.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import java.math.BigDecimal;
import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@TestPropertySource(properties = {
    "spring.main.web-application-type=none"
})
class FlightServiceTest {

    private FlightService flightService;

    @BeforeEach
    void setUp() {
        flightService = new FlightService();
    }

    @Test
    void testSearchFlights() {
        // Create a test request
        FlightSearchRequest request = new FlightSearchRequest();
        request.setFromCity("LHR");
        request.setToCity("CDG");
        request.setDepartureDate(LocalDate.now().plusDays(7));
        request.setTripType("ONE_WAY");
        request.setCabinClass("ECONOMY");
        
        FlightSearchRequest.PassengerInfo passengerInfo = new FlightSearchRequest.PassengerInfo();
        passengerInfo.setAdults(1);
        passengerInfo.setChildren(0);
        passengerInfo.setInfants(0);
        request.setPassengerInfo(passengerInfo);

        // Test the service
        FlightSearchResponse response = flightService.searchFlights(request);

        // Verify the response
        assertNotNull(response);
        assertNotNull(response.getFlights());
        assertEquals(10, response.getFlights().size());
        assertNotNull(response.getSummary());
        assertEquals(10, response.getSummary().getTotalResults());
        
        // Verify first flight
        FlightSearchResponse.FlightOption firstFlight = response.getFlights().get(0);
        assertNotNull(firstFlight.getFlightId());
        assertEquals("LHR", firstFlight.getDepartureAirport());
        assertEquals("CDG", firstFlight.getArrivalAirport());
        assertNotNull(firstFlight.getFareOptions());
        assertTrue(firstFlight.getFareOptions().size() > 0);
    }

    @Test
    void testBookFlight() {
        // First search for flights to get a valid flight ID and fare ID
        FlightSearchRequest searchRequest = new FlightSearchRequest();
        searchRequest.setFromCity("LHR");
        searchRequest.setToCity("CDG");
        searchRequest.setDepartureDate(LocalDate.now().plusDays(7));
        searchRequest.setTripType("ONE_WAY");
        searchRequest.setCabinClass("ECONOMY");
        
        FlightSearchRequest.PassengerInfo passengerInfo = new FlightSearchRequest.PassengerInfo();
        passengerInfo.setAdults(1);
        passengerInfo.setChildren(0);
        passengerInfo.setInfants(0);
        searchRequest.setPassengerInfo(passengerInfo);

        FlightSearchResponse searchResponse = flightService.searchFlights(searchRequest);
        String flightId = searchResponse.getFlights().get(0).getFlightId();
        String fareId = searchResponse.getFlights().get(0).getFareOptions().get(0).getFareId();

        // Create booking request
        BookingRequest bookingRequest = new BookingRequest();
        bookingRequest.setFlightId(flightId);
        bookingRequest.setFareId(fareId);
        
        // Create contact info
        BookingRequest.ContactInfo contactInfo = new BookingRequest.ContactInfo();
        contactInfo.setPhone("+1234567890");
        contactInfo.setEmail("test@example.com");
        bookingRequest.setContactInfo(contactInfo);
        
        BookingRequest.Passenger passenger = new BookingRequest.Passenger();
        passenger.setFirstName("John");
        passenger.setLastName("Doe");
        passenger.setPassengerType("ADULT");
        passenger.setDocumentType("PASSPORT");
        passenger.setDocumentNumber("123456789");
        passenger.setDateOfBirth("1990-01-01");
        passenger.setNationality("US");
        bookingRequest.setPassengers(java.util.List.of(passenger));

        // Test the booking service
        BookingResponse bookingResponse = flightService.bookFlight(bookingRequest);

        // Verify the response
        assertNotNull(bookingResponse);
        assertNotNull(bookingResponse.getBookingId());
        assertNotNull(bookingResponse.getConfirmationNumber());
        assertEquals("CONFIRMED", bookingResponse.getStatus());
        assertNotNull(bookingResponse.getFlightInfo());
        // Note: flightId is the internal ID, flightNumber is the airline flight number (e.g., BA123)
        assertNotNull(bookingResponse.getFlightInfo().getFlightNumber());
        
        // Verify payment info is properly set
        assertNotNull(bookingResponse.getPaymentInfo());
        assertNotNull(bookingResponse.getPaymentInfo().getAmount());
        assertTrue(bookingResponse.getPaymentInfo().getAmount().compareTo(BigDecimal.ZERO) > 0, "Payment amount should be greater than 0");
        assertNotNull(bookingResponse.getPaymentInfo().getCurrency());
        assertEquals("USD", bookingResponse.getPaymentInfo().getCurrency());
    }
}
