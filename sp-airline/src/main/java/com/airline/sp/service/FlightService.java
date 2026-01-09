package com.airline.sp.service;

import com.airline.common.model.*;
import com.airline.common.model.BookingRequest.Passenger;

import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ThreadLocalRandom;

@Service
public class FlightService {

    private final Map<String, BookingResponse> bookings = new HashMap<>();
    private final Map<String, FlightSearchResponse.FlightOption> flights = new HashMap<>();

    public FlightSearchResponse searchFlights(FlightSearchRequest request) {
        FlightSearchResponse response = new FlightSearchResponse();
        List<FlightSearchResponse.FlightOption> flightOptions = new ArrayList<>();
        
        // Generate mock flight data
        for (int i = 0; i < 10; i++) {
            FlightSearchResponse.FlightOption flight = createMockFlight(request);
            flightOptions.add(flight);
            flights.put(flight.getFlightId(), flight);
        }
        
        response.setFlights(flightOptions);
        response.setSummary(createSearchSummary(flightOptions, request.getDepartureDate()));
        
        return response;
    }

    public BookingResponse bookFlight(BookingRequest request) {
        BookingResponse response = new BookingResponse();
        
        // Generate booking information
        response.setBookingId("BK" + System.currentTimeMillis());
        response.setStatus("CONFIRMED");
        response.setBookingDate(LocalDateTime.now());
        response.setConfirmationNumber(generatePNR());
        
        // Get flight information
        FlightSearchResponse.FlightOption flight = flights.get(request.getFlightId());
        FlightSearchResponse.FareOption fare = null;
        
        if (flight != null) {
            // Find corresponding fare
            fare = flight.getFareOptions().stream()
                    .filter(f -> f.getFareId().equals(request.getFareId()))
                    .findFirst()
                    .orElse(null);
            
            if (fare != null) {
                BookingResponse.FlightInfo flightInfo = new BookingResponse.FlightInfo();
                flightInfo.setFlightId(flight.getFlightId());
                flightInfo.setFlightNumber(flight.getFlightNumber());
                flightInfo.setDepartureAirport(flight.getDepartureAirport());
                flightInfo.setDepartureCity(flight.getDepartureCity());
                flightInfo.setDepartureTime(flight.getDepartureTime());
                flightInfo.setArrivalAirport(flight.getArrivalAirport());
                flightInfo.setArrivalCity(flight.getArrivalCity());
                flightInfo.setArrivalTime(flight.getArrivalTime());
                flightInfo.setCabinClass(fare.getCabinClass());
                
                response.setFlightInfo(flightInfo);
            }
        }

        // Save passenger information
        List<BookingResponse.PassengerInfo> passengers = new ArrayList<>();
        for (BookingRequest.Passenger passenger : request.getPassengers()) {
            BookingResponse.PassengerInfo passengerInfo = new BookingResponse.PassengerInfo();
            // Truncate First Name and Last Name to 10 characters
            passengerInfo.setFirstName(passenger.getFirstName().substring(0, Math.min(10, passenger.getFirstName().length())));
            passengerInfo.setLastName(passenger.getLastName().substring(0, Math.min(10, passenger.getLastName().length())));
            passengerInfo.setPassengerId("P" + System.currentTimeMillis() + ThreadLocalRandom.current().nextInt(1000));
            passengerInfo.setPassengerType(passenger.getPassengerType());
            passengerInfo.setDocumentType(passenger.getDocumentType());
            passengerInfo.setDocumentNumber(passenger.getDocumentNumber());
            passengerInfo.setSeatNumber("" + (ThreadLocalRandom.current().nextInt(30) + 1) + (char)('A' + ThreadLocalRandom.current().nextInt(6)));
            passengerInfo.setMealPreference("Standard");
            passengers.add(passengerInfo);
        }
        response.setPassengers(passengers);
        
        // Add payment info with actual fare details
        BookingResponse.PaymentInfo paymentInfo = new BookingResponse.PaymentInfo();
        paymentInfo.setPaymentId("PENDING");
        
        // Use the fare we found earlier
        if (fare != null) {
            paymentInfo.setAmount(fare.getPrice());
            paymentInfo.setCurrency(fare.getCurrency());
        } else {
            paymentInfo.setAmount(BigDecimal.ZERO);
            paymentInfo.setCurrency("USD");
        }
        
        paymentInfo.setPaymentMethod("PENDING");
        paymentInfo.setPaymentStatus("PENDING");
        paymentInfo.setPaymentDate(LocalDateTime.now());
        response.setPaymentInfo(paymentInfo);
        
        // Save booking information with both keys for easy lookup
        bookings.put(response.getConfirmationNumber(), response);
        bookings.put(response.getBookingId(), response);
        
        return response;
    }

    public PaymentResponse payAndIssue(PaymentRequest request) {
        PaymentResponse response = new PaymentResponse();
        
        // Get booking information
        BookingResponse booking = bookings.get(request.getBookingId());
        if (booking == null) {
            throw new RuntimeException("Booking information does not exist");
        }
        
        // Simulate payment processing
        response.setPaymentId("PAY" + System.currentTimeMillis());
        response.setStatus("SUCCESS");
        response.setAmount(request.getAmount());
        response.setCurrency(request.getCurrency());
        response.setPaymentMethod(request.getPaymentMethod());
        response.setPaymentDate(LocalDateTime.now());
        response.setTransactionId("TXN" + System.currentTimeMillis());
        response.setMessage("Payment processed successfully");
        
        // Update booking payment information
        BookingResponse.PaymentInfo paymentInfo = booking.getPaymentInfo();
        paymentInfo.setPaymentId(response.getPaymentId());
        paymentInfo.setPaymentStatus("PAID");
        paymentInfo.setPaymentMethod(request.getPaymentMethod());
        paymentInfo.setPaymentDate(response.getPaymentDate());
        
        return response;
    }

    private FlightSearchResponse.FlightOption createMockFlight(FlightSearchRequest request) {
        FlightSearchResponse.FlightOption flight = new FlightSearchResponse.FlightOption();
        
        // Randomly select airline
        String[] airlines = {
            "British Airways", "Lufthansa", "Air France", "KLM", "Swiss", 
            "Austrian Airlines", "SAS", "Finnair", "Iberia", "TAP Portugal"
        };
        String[] airlineCodes = {
            "BA", "LH", "AF", "KL", "LX", "OS", "SK", "AY", "IB", "TP"
        };
        
        int airlineIndex = ThreadLocalRandom.current().nextInt(airlines.length);
        String airlineName = airlines[airlineIndex];
        String airlineCode = airlineCodes[airlineIndex];
        
        flight.setFlightId("FL" + System.currentTimeMillis() + ThreadLocalRandom.current().nextInt(1000));
        flight.setAirlineCode(airlineCode);
        flight.setAirlineName(airlineName);
        flight.setFlightNumber(airlineCode + (100 + ThreadLocalRandom.current().nextInt(900)));
        
        // Use airport codes from frontend
        flight.setDepartureAirport(request.getFromCity());
        flight.setArrivalAirport(request.getToCity());
        
        // Set city names based on airport codes
        flight.setDepartureCity(getCityNameByAirportCode(request.getFromCity()));
        flight.setArrivalCity(getCityNameByAirportCode(request.getToCity()));
        
        // Generate random time
        int hour = ThreadLocalRandom.current().nextInt(24);
        int minute = ThreadLocalRandom.current().nextInt(60);
        LocalDateTime departureTime = request.getDepartureDate().atTime(hour, minute);
        flight.setDepartureTime(departureTime);
        
        int duration = 85 + ThreadLocalRandom.current().nextInt(30); // 85-115 minutes
        flight.setDurationMinutes(duration);
        flight.setArrivalTime(departureTime.plusMinutes(duration));
        
        flight.setFlightType("DIRECT");
        flight.setHasWifi(true);
        flight.setHasPowerOutlet(true);
        flight.setCo2Emission("7% less CO2e than typical");
        
        // Generate fare options
        flight.setFareOptions(createMockFareOptions(airlineName));
        
        return flight;
    }

    private List<FlightSearchResponse.FareOption> createMockFareOptions(String airlineName) {
        List<FlightSearchResponse.FareOption> fareOptions = new ArrayList<>();
        
        // Create different fare brand options for each airline
        String[] fareBrands = {"Basic", "Standard", "Flex", "Premium"};
        String[] descriptions = {
            "Basic fare, non-refundable and non-changeable",
            "Standard fare, partial refund and change",
            "Flexible fare, free refund and change",
            "Premium fare, full service"
        };
        
        int basePrice = 750 + ThreadLocalRandom.current().nextInt(100);
        
        for (int i = 0; i < fareBrands.length; i++) {
            FlightSearchResponse.FareOption fare = new FlightSearchResponse.FareOption();
            fare.setFareId("FARE" + System.currentTimeMillis() + i);
            fare.setProviderName(airlineName);
            fare.setCabinClass("ECONOMY");
            
            // Generate different prices based on brand
            int priceMultiplier = 100 + (i * 25); // Basic=100%, Standard=125%, Flex=150%, Premium=175%
            fare.setPrice(new BigDecimal(basePrice * priceMultiplier / 100));
            fare.setCurrency("USD");
            
            fare.setRating(5);
            fare.setReviewCount(ThreadLocalRandom.current().nextInt(200, 1000));
            fare.setRecommended(i == 2); // Flex fare recommended
            fare.setPaymentOption(null);
            
            // Baggage information varies by brand
            FlightSearchResponse.BaggageInfo baggage = new FlightSearchResponse.BaggageInfo();
            baggage.setCabinBags(1);
            baggage.setCheckedBags(i == 0 ? 0 : (i == 1 ? 1 : 2)); // Basic=0, Standard=1, Flex/Premium=2
            baggage.setCabinBagIncluded(true);
            baggage.setCheckedBagIncluded(i > 0);
            fare.setBaggageInfo(baggage);
            
            // Add brand information
            fare.setFareBrand(fareBrands[i]);
            fare.setDescription(descriptions[i]);
            
            fareOptions.add(fare);
        }
        
        return fareOptions;
    }

    private FlightSearchResponse.SearchSummary createSearchSummary(
            List<FlightSearchResponse.FlightOption> flights, LocalDate departureDate) {
        FlightSearchResponse.SearchSummary summary = new FlightSearchResponse.SearchSummary();
        
        summary.setTotalResults(flights.size());
        summary.setSortBy("Best");
        
        // Calculate price range
        BigDecimal minPrice = flights.stream()
                .flatMap(f -> f.getFareOptions().stream())
                .map(FlightSearchResponse.FareOption::getPrice)
                .min(BigDecimal::compareTo)
                .orElse(BigDecimal.ZERO);
        
        BigDecimal maxPrice = flights.stream()
                .flatMap(f -> f.getFareOptions().stream())
                .map(FlightSearchResponse.FareOption::getPrice)
                .max(BigDecimal::compareTo)
                .orElse(BigDecimal.ZERO);
        
        summary.setLowestPrice(minPrice);
        summary.setHighestPrice(maxPrice);
        
        // Generate date price information
        List<FlightSearchResponse.DatePrice> datePrices = new ArrayList<>();
        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("dd MMM");
        
        for (int i = 0; i < 6; i++) {
            FlightSearchResponse.DatePrice datePrice = new FlightSearchResponse.DatePrice();
            LocalDate date = departureDate.plusDays(i);
            datePrice.setDate(date.format(formatter));
            datePrice.setMinPrice(new BigDecimal(795 + i * 5 + ThreadLocalRandom.current().nextInt(10)));
            datePrice.setSelected(i == 0);
            datePrices.add(datePrice);
        }
        
        summary.setDatePrices(datePrices);
        
        return summary;
    }

    private String generatePNR() {
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        StringBuilder pnr = new StringBuilder();
        for (int i = 0; i < 6; i++) {
            pnr.append(chars.charAt(ThreadLocalRandom.current().nextInt(chars.length())));
        }
        return pnr.toString();
    }
    
    private String getCityNameByAirportCode(String airportCode) {
        Map<String, String> airportCities = new HashMap<>();
        airportCities.put("LHR", "London");
        airportCities.put("CDG", "Paris");
        airportCities.put("FRA", "Frankfurt");
        airportCities.put("AMS", "Amsterdam");
        airportCities.put("MAD", "Madrid");
        airportCities.put("BCN", "Barcelona");
        airportCities.put("FCO", "Rome");
        airportCities.put("MXP", "Milan");
        airportCities.put("ZRH", "Zurich");
        airportCities.put("VIE", "Vienna");
        airportCities.put("CPH", "Copenhagen");
        airportCities.put("ARN", "Stockholm");
        airportCities.put("OSL", "Oslo");
        airportCities.put("HEL", "Helsinki");
        airportCities.put("WAW", "Warsaw");
        airportCities.put("PRG", "Prague");
        airportCities.put("BUD", "Budapest");
        airportCities.put("ATH", "Athens");
        airportCities.put("IST", "Istanbul");
        
        return airportCities.getOrDefault(airportCode, airportCode);
    }

    // ==================== ORDER MANAGEMENT ====================
    
    public BookingResponse queryOrder(OrderQueryRequest request) {
        // Find booking by confirmation number
        BookingResponse booking = bookings.get(request.getConfirmationNumber());
        
        if (booking == null) {
            throw new RuntimeException("Booking not found with confirmation number: " + request.getConfirmationNumber());
        }
        
        // Verify passenger last name (using the first passenger)
        if (booking.getPassengers() != null && !booking.getPassengers().isEmpty()) {
            String storedLastName = booking.getPassengers().get(0).getLastName();
            // Case-insensitive comparison and handle truncated names
            if (!storedLastName.equalsIgnoreCase(request.getPassengerLastName()) && 
                !request.getPassengerLastName().toLowerCase().startsWith(storedLastName.toLowerCase())) {
                throw new RuntimeException("Passenger last name does not match");
            }
        }
        
        return booking;
    }

    // ==================== REFUND FUNCTIONALITY ====================
    
    public RefundResponse processRefund(RefundRequest request) {
        RefundResponse response = new RefundResponse();
        
        // Find booking
        BookingResponse booking = bookings.get(request.getBookingId());
        if (booking == null) {
            booking = bookings.get(request.getConfirmationNumber());
        }
        
        if (booking == null) {
            response.setStatus("FAILED");
            response.setFailureReason("Booking not found");
            response.setMessage("Unable to find booking with provided information");
            return response;
        }
        
        // Verify passenger last name
        String storedLastName = booking.getPassengers().get(0).getLastName();
        if (!storedLastName.equalsIgnoreCase(request.getPassengerLastName()) && 
            !request.getPassengerLastName().toLowerCase().startsWith(storedLastName.toLowerCase())) {
            response.setStatus("FAILED");
            response.setFailureReason("Passenger name mismatch");
            response.setMessage("Passenger last name does not match booking records");
            return response;
        }
        
        // Check booking status
        if ("CANCELLED".equals(booking.getStatus())) {
            response.setStatus("FAILED");
            response.setFailureReason("Already cancelled");
            response.setMessage("This booking has already been cancelled");
            return response;
        }
        
        // Check payment status - only allow refund for paid bookings
        if (!"PAID".equals(booking.getPaymentInfo().getPaymentStatus())) {
            response.setStatus("FAILED");
            response.setFailureReason("Payment not completed");
            response.setMessage("This booking has not been paid yet. Only paid bookings can be refunded.");
            return response;
        }
        
        // EXCEPTION CASE 1: Check if flight has already departed
        LocalDateTime departureTime = booking.getFlightInfo().getDepartureTime();
        LocalDateTime now = LocalDateTime.now();
        
        if (now.isAfter(departureTime)) {
            response.setStatus("FAILED");
            response.setFailureReason("Flight already departed");
            response.setMessage("Refund not allowed for flights that have already departed. Please contact customer service.");
            return response;
        }
        
        // EXCEPTION CASE 2: Flights departing within 2 hours cannot be refunded
        long hoursUntilDeparture = java.time.Duration.between(now, departureTime).toHours();
        
        if (hoursUntilDeparture < 2) {
            response.setStatus("FAILED");
            response.setFailureReason("Too close to departure");
            response.setMessage("Refund not allowed within 2 hours of departure. Please contact customer service.");
            return response;
        }
        
        // EXCEPTION CASE 3: Bookings with confirmation numbers starting with "NO" cannot be refunded
        if (request.getConfirmationNumber().startsWith("NO")) {
            response.setStatus("FAILED");
            response.setFailureReason("Non-refundable fare");
            response.setMessage("This booking was made with a non-refundable fare. No refund is available.");
            return response;
        }
        
        // Calculate refund amount
        BigDecimal totalAmount = booking.getPaymentInfo().getAmount();
        BigDecimal cancellationFee = calculateCancellationFee(hoursUntilDeparture, request.getRefundReason(), totalAmount);
        BigDecimal netRefundAmount = totalAmount.subtract(cancellationFee);
        
        // Process refund
        response.setRefundId("RF" + System.currentTimeMillis());
        response.setBookingId(booking.getBookingId());
        response.setConfirmationNumber(booking.getConfirmationNumber());
        response.setStatus("SUCCESS");
        response.setRefundAmount(totalAmount);
        response.setCurrency(booking.getPaymentInfo().getCurrency());
        response.setCancellationFee(cancellationFee);
        response.setNetRefundAmount(netRefundAmount);
        response.setRefundMethod("ORIGINAL_PAYMENT");
        response.setRefundDate(LocalDateTime.now());
        response.setEstimatedRefundDays(7);
        response.setMessage("Refund processed successfully. Amount will be credited to your original payment method within 7-10 business days.");
        
        // Update booking status
        booking.setStatus("CANCELLED");
        
        return response;
    }
    
    private BigDecimal calculateCancellationFee(long hoursUntilDeparture, String refundReason, BigDecimal totalAmount) {
        // Schedule change by airline - no fee
        if ("SCHEDULE_CHANGE".equals(refundReason)) {
            return BigDecimal.ZERO;
        }
        
        // Emergency - reduced fee
        if ("EMERGENCY".equals(refundReason)) {
            return totalAmount.multiply(new BigDecimal("0.10")); // 10% fee
        }
        
        // Time-based cancellation fees for personal reasons
        if (hoursUntilDeparture > 72) {
            return totalAmount.multiply(new BigDecimal("0.15")); // 15% fee
        } else if (hoursUntilDeparture > 24) {
            return totalAmount.multiply(new BigDecimal("0.30")); // 30% fee
        } else {
            return totalAmount.multiply(new BigDecimal("0.50")); // 50% fee
        }
    }

    // ==================== FLIGHT CHANGE FUNCTIONALITY ====================
    
    public ChangeFlightResponse changeFlight(ChangeFlightRequest request) {
        ChangeFlightResponse response = new ChangeFlightResponse();
        
        // Find original booking
        BookingResponse originalBooking = bookings.get(request.getOriginalBookingId());
        if (originalBooking == null) {
            originalBooking = bookings.get(request.getConfirmationNumber());
        }
        
        if (originalBooking == null) {
            response.setStatus("FAILED");
            response.setFailureReason("Booking not found");
            response.setMessage("Unable to find booking with provided information");
            return response;
        }
        
        // Verify passenger last name
        String storedLastName = originalBooking.getPassengers().get(0).getLastName();
        if (!storedLastName.equalsIgnoreCase(request.getPassengerLastName()) && 
            !request.getPassengerLastName().toLowerCase().startsWith(storedLastName.toLowerCase())) {
            response.setStatus("FAILED");
            response.setFailureReason("Passenger name mismatch");
            response.setMessage("Passenger last name does not match booking records");
            return response;
        }
        
        // Check if flight has already departed
        LocalDateTime departureTime = originalBooking.getFlightInfo().getDepartureTime();
        LocalDateTime now = LocalDateTime.now();
        
        if (now.isAfter(departureTime)) {
            response.setStatus("FAILED");
            response.setFailureReason("Flight already departed");
            response.setMessage("Flight changes not allowed for flights that have already departed. Please contact customer service.");
            return response;
        }
        
        // EXCEPTION CASE 3: Flights departing within 4 hours cannot be changed
        long hoursUntilDeparture = java.time.Duration.between(now, departureTime).toHours();
        
        if (hoursUntilDeparture < 4) {
            response.setStatus("FAILED");
            response.setFailureReason("Too close to departure");
            response.setMessage("Flight changes not allowed within 4 hours of departure. Please contact customer service.");
            return response;
        }
        
        // EXCEPTION CASE 4: Simulate flight full - if new flight ID contains "FULL"
        if (request.getNewFlightId().contains("FULL")) {
            response.setStatus("FAILED");
            response.setFailureReason("Flight fully booked");
            response.setMessage("The selected flight is fully booked. Please choose another flight.");
            return response;
        }
        
        // Find new flight
        FlightSearchResponse.FlightOption newFlight = flights.get(request.getNewFlightId());
        if (newFlight == null) {
            response.setStatus("FAILED");
            response.setFailureReason("New flight not found");
            response.setMessage("The selected flight is not available. Please search again.");
            return response;
        }
        
        // Find new fare
        FlightSearchResponse.FareOption newFare = newFlight.getFareOptions().stream()
                .filter(f -> f.getFareId().equals(request.getNewFareId()))
                .findFirst()
                .orElse(null);
        
        if (newFare == null) {
            response.setStatus("FAILED");
            response.setFailureReason("New fare not found");
            response.setMessage("The selected fare is not available.");
            return response;
        }
        
        // Calculate change fee and price difference
        BigDecimal originalPrice = originalBooking.getPaymentInfo().getAmount();
        BigDecimal newPrice = newFare.getPrice();
        BigDecimal changeFee = calculateChangeFee(hoursUntilDeparture, request.getChangeReason(), originalPrice);
        BigDecimal priceDifference = newPrice.subtract(originalPrice);
        BigDecimal totalAdditionalPayment = changeFee.add(priceDifference.max(BigDecimal.ZERO));
        
        // Create new booking
        String newBookingId = "BK" + System.currentTimeMillis() + "CHG";
        String newConfirmationNumber = generatePNR();
        
        // Build response
        response.setChangeId("CH" + System.currentTimeMillis());
        response.setOriginalBookingId(originalBooking.getBookingId());
        response.setNewBookingId(newBookingId);
        response.setNewConfirmationNumber(newConfirmationNumber);
        response.setStatus("SUCCESS");
        
        // Original flight info
        ChangeFlightResponse.FlightInfo originalFlightInfo = new ChangeFlightResponse.FlightInfo();
        originalFlightInfo.setFlightId(originalBooking.getFlightInfo().getFlightId());
        originalFlightInfo.setFlightNumber(originalBooking.getFlightInfo().getFlightNumber());
        originalFlightInfo.setDepartureCity(originalBooking.getFlightInfo().getDepartureCity());
        originalFlightInfo.setArrivalCity(originalBooking.getFlightInfo().getArrivalCity());
        originalFlightInfo.setDepartureTime(originalBooking.getFlightInfo().getDepartureTime());
        originalFlightInfo.setArrivalTime(originalBooking.getFlightInfo().getArrivalTime());
        originalFlightInfo.setCabinClass(originalBooking.getFlightInfo().getCabinClass());
        response.setOriginalFlight(originalFlightInfo);
        
        // New flight info
        ChangeFlightResponse.FlightInfo newFlightInfo = new ChangeFlightResponse.FlightInfo();
        newFlightInfo.setFlightId(newFlight.getFlightId());
        newFlightInfo.setFlightNumber(newFlight.getFlightNumber());
        newFlightInfo.setDepartureCity(newFlight.getDepartureCity());
        newFlightInfo.setArrivalCity(newFlight.getArrivalCity());
        newFlightInfo.setDepartureTime(newFlight.getDepartureTime());
        newFlightInfo.setArrivalTime(newFlight.getArrivalTime());
        newFlightInfo.setCabinClass(newFare.getCabinClass());
        response.setNewFlight(newFlightInfo);
        
        response.setOriginalPrice(originalPrice);
        response.setNewPrice(newPrice);
        response.setChangeFee(changeFee);
        response.setPriceDifference(priceDifference);
        response.setTotalAdditionalPayment(totalAdditionalPayment);
        response.setCurrency(originalBooking.getPaymentInfo().getCurrency());
        response.setChangeDate(LocalDateTime.now());
        response.setMessage("Flight change successful. " + 
            (totalAdditionalPayment.compareTo(BigDecimal.ZERO) > 0 ? 
             "Please complete payment of " + totalAdditionalPayment + " " + response.getCurrency() : 
             "No additional payment required."));
        
        // Update original booking status
        originalBooking.setStatus("CHANGED");
        
        // Create new booking record (simplified - reuse passengers)
        BookingResponse newBooking = new BookingResponse();
        newBooking.setBookingId(newBookingId);
        newBooking.setConfirmationNumber(newConfirmationNumber);
        newBooking.setStatus("CONFIRMED");
        newBooking.setBookingDate(LocalDateTime.now());
        
        BookingResponse.FlightInfo flightInfo = new BookingResponse.FlightInfo();
        flightInfo.setFlightId(newFlight.getFlightId());
        flightInfo.setFlightNumber(newFlight.getFlightNumber());
        flightInfo.setDepartureAirport(newFlight.getDepartureAirport());
        flightInfo.setDepartureCity(newFlight.getDepartureCity());
        flightInfo.setDepartureTime(newFlight.getDepartureTime());
        flightInfo.setArrivalAirport(newFlight.getArrivalAirport());
        flightInfo.setArrivalCity(newFlight.getArrivalCity());
        flightInfo.setArrivalTime(newFlight.getArrivalTime());
        flightInfo.setCabinClass(newFare.getCabinClass());
        newBooking.setFlightInfo(flightInfo);
        
        newBooking.setPassengers(originalBooking.getPassengers());
        
        BookingResponse.PaymentInfo paymentInfo = new BookingResponse.PaymentInfo();
        paymentInfo.setAmount(newPrice);
        paymentInfo.setCurrency(response.getCurrency());
        paymentInfo.setPaymentStatus("PAID");
        paymentInfo.setPaymentDate(LocalDateTime.now());
        newBooking.setPaymentInfo(paymentInfo);
        
        // Store new booking
        bookings.put(newConfirmationNumber, newBooking);
        bookings.put(newBookingId, newBooking);
        
        return response;
    }
    
    private BigDecimal calculateChangeFee(long hoursUntilDeparture, String changeReason, BigDecimal originalPrice) {
        // Schedule change by airline - no fee
        if ("SCHEDULE_CHANGE".equals(changeReason)) {
            return BigDecimal.ZERO;
        }
        
        // Emergency - reduced fee
        if ("EMERGENCY".equals(changeReason)) {
            return new BigDecimal("50.00"); // Flat $50 fee
        }
        
        // Time-based change fees
        if (hoursUntilDeparture > 72) {
            return new BigDecimal("75.00"); // $75 fee
        } else if (hoursUntilDeparture > 24) {
            return new BigDecimal("150.00"); // $150 fee
        } else {
            return new BigDecimal("250.00"); // $250 fee
        }
    }

    // ==================== BAGGAGE PURCHASE FUNCTIONALITY ====================
    
    public BaggageResponse purchaseBaggage(BaggageRequest request) {
        BaggageResponse response = new BaggageResponse();
        
        // Find booking
        BookingResponse booking = bookings.get(request.getBookingId());
        if (booking == null) {
            booking = bookings.get(request.getConfirmationNumber());
        }
        
        if (booking == null) {
            response.setStatus("FAILED");
            response.setFailureReason("Booking not found");
            response.setMessage("Unable to find booking with provided information");
            return response;
        }
        
        // Verify passenger last name
        String storedLastName = booking.getPassengers().get(0).getLastName();
        if (!storedLastName.equalsIgnoreCase(request.getPassengerLastName()) && 
            !request.getPassengerLastName().toLowerCase().startsWith(storedLastName.toLowerCase())) {
            response.setStatus("FAILED");
            response.setFailureReason("Passenger name mismatch");
            response.setMessage("Passenger last name does not match booking records");
            return response;
        }
        
        // Verify passenger exists in booking
        boolean passengerFound = booking.getPassengers().stream()
                .anyMatch(p -> p.getPassengerId().equals(request.getPassengerId()));
        
        if (!passengerFound) {
            response.setStatus("FAILED");
            response.setFailureReason("Passenger not found");
            response.setMessage("Passenger ID not found in this booking");
            return response;
        }
        
        // EXCEPTION CASE 5: Cannot purchase more than 5 additional bags
        if (request.getAdditionalBags() > 5) {
            response.setStatus("FAILED");
            response.setFailureReason("Exceeds maximum limit");
            response.setMessage("Maximum 5 additional bags allowed per passenger. Please contact customer service for special requests.");
            return response;
        }
        
        // EXCEPTION CASE 6: Simulate payment failure for baggage orders over $500
        List<BaggageResponse.BaggageItem> baggageItems = new ArrayList<>();
        BigDecimal totalAmount = BigDecimal.ZERO;
        
        for (int i = 0; i < request.getAdditionalBags(); i++) {
            BaggageResponse.BaggageItem item = new BaggageResponse.BaggageItem();
            item.setItemId("BAG" + System.currentTimeMillis() + i);
            item.setBaggageType(request.getBaggageType());
            
            BigDecimal unitPrice;
            String weightLimit;
            String sizeLimit;
            String description;
            
            switch (request.getBaggageType()) {
                case "CHECKED":
                    unitPrice = new BigDecimal("35.00");
                    weightLimit = "23kg";
                    sizeLimit = "158cm total dimensions";
                    description = "Standard checked baggage";
                    break;
                case "OVERWEIGHT":
                    unitPrice = new BigDecimal("75.00");
                    weightLimit = "32kg";
                    sizeLimit = "158cm total dimensions";
                    description = "Overweight baggage (23-32kg)";
                    break;
                case "OVERSIZED":
                    unitPrice = new BigDecimal("100.00");
                    weightLimit = "32kg";
                    sizeLimit = "203cm total dimensions";
                    description = "Oversized baggage";
                    break;
                case "SPORTS_EQUIPMENT":
                    unitPrice = new BigDecimal("150.00");
                    weightLimit = "32kg";
                    sizeLimit = "Varies by equipment";
                    description = "Sports equipment - " + (request.getEquipmentType() != null ? request.getEquipmentType() : "General");
                    break;
                default:
                    unitPrice = new BigDecimal("35.00");
                    weightLimit = "23kg";
                    sizeLimit = "158cm total dimensions";
                    description = "Additional baggage";
            }
            
            item.setUnitPrice(unitPrice);
            item.setQuantity(1);
            item.setTotalPrice(unitPrice);
            item.setWeightLimit(weightLimit);
            item.setSizeLimit(sizeLimit);
            item.setDescription(description);
            
            baggageItems.add(item);
            totalAmount = totalAmount.add(unitPrice);
        }
        
        // Check if total exceeds $500 (simulated payment failure)
        if (totalAmount.compareTo(new BigDecimal("500.00")) > 0) {
            response.setStatus("FAILED");
            response.setFailureReason("Payment processing failed");
            response.setMessage("Payment declined. Please try with fewer bags or contact your payment provider.");
            return response;
        }
        
        // Success case
        response.setBaggageOrderId("BO" + System.currentTimeMillis());
        response.setBookingId(booking.getBookingId());
        response.setConfirmationNumber(booking.getConfirmationNumber());
        response.setPassengerId(request.getPassengerId());
        response.setStatus("SUCCESS");
        response.setBaggageItems(baggageItems);
        response.setTotalAmount(totalAmount);
        response.setCurrency("USD");
        response.setPurchaseDate(LocalDateTime.now());
        response.setPaymentStatus("PAID");
        response.setMessage("Baggage purchase successful. Your baggage allowance has been updated.");
        
        return response;
    }
}
