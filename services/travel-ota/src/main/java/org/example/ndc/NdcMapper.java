package org.example.ndc;

import org.example.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

@Component
public class NdcMapper {

    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE_TIME;
    private final ObjectMapper mapper = new ObjectMapper();

    public ObjectNode toAirShoppingRq(FlightSearchRequest req) {
        ObjectNode root = mapper.createObjectNode();
        ObjectNode rq = root.putObject("IATA_AirShoppingRQ");
        ObjectNode request = rq.putObject("Request");
        ObjectNode criteria = request.putObject("FlightCriteria").putObject("OriginDestCriteria");
        ObjectNode dep = criteria.putObject("OriginDepCriteria");
        dep.put("IATA_LocationCode", req.getFromCity());
        dep.put("Date", req.getDepartureDate().toString());
        ObjectNode arr = criteria.putObject("DestArrivalCriteria");
        arr.put("IATA_LocationCode", req.getToCity());
        return root;
    }

    public FlightSearchResponse fromAirShoppingRs(JsonNode root) {
        JsonNode rs = root.path("IATA_AirShoppingRS");
        if (rs.isMissingNode()) {
            throw new IllegalStateException("Invalid AirShoppingRS");
        }
        if (rs.has("Error")) {
            throw new IllegalStateException(rs.path("Error").path("DescText").asText("AirShopping failed"));
        }
        FlightSearchResponse response = new FlightSearchResponse();
        List<FlightSearchResponse.FlightOption> flights = new ArrayList<>();
        JsonNode carrierOffers = rs.path("Response").path("OffersGroup").path("CarrierOffers");
        if (carrierOffers.isArray()) {
            for (JsonNode co : carrierOffers) {
                JsonNode offer = co.path("Offer");
                if (offer.isMissingNode()) continue;
                flights.add(mapOfferToFlight(offer));
            }
        }
        response.setFlights(flights);
        JsonNode summary = rs.path("Response").path("DataLists").path("Summary");
        if (!summary.isMissingNode()) {
            response.setSummary(mapSummary(summary, flights.size()));
        } else if (!flights.isEmpty()) {
            response.setSummary(defaultSummary(flights));
        }
        return response;
    }

    public ObjectNode toOfferPriceRq(String offerId, String offerItemId) {
        ObjectNode root = mapper.createObjectNode();
        ObjectNode rq = root.putObject("IATA_OfferPriceRQ");
        ObjectNode selected = rq.putObject("Request").putObject("PricedOffer");
        selected.put("OfferRefID", offerId);
        selected.put("OfferItemRefID", offerItemId);
        return root;
    }

    public ObjectNode toOrderCreateRq(BookingRequest req) {
        ObjectNode root = mapper.createObjectNode();
        ObjectNode rq = root.putObject("IATA_OrderCreateRQ");
        ObjectNode request = rq.putObject("Request");
        ObjectNode priced = request.putObject("CreateOrder")
                .putObject("AcceptSelectedQuotedOfferList")
                .putObject("SelectedPricedOffer");
        priced.put("OfferRefID", req.getFlightId());
        ArrayNode items = priced.putArray("SelectedOfferItem");
        items.addObject().put("OfferItemRefID", req.getFareId());
        ArrayNode paxList = request.putObject("DataLists").putArray("PaxList");
        for (BookingRequest.Passenger p : req.getPassengers()) {
            ObjectNode pax = paxList.addObject();
            pax.put("PTC", p.getPassengerType());
            ObjectNode ind = pax.putObject("Individual");
            ind.put("GivenName", p.getFirstName());
            ind.put("Surname", p.getLastName());
            pax.put("documentType", p.getDocumentType());
            pax.put("documentNumber", p.getDocumentNumber());
        }
        return root;
    }

    public BookingResponse fromOrderViewRs(JsonNode root) {
        JsonNode order = root.path("IATA_OrderViewRS").path("Response").path("Order");
        if (order.isMissingNode()) {
            JsonNode err = root.path("IATA_OrderViewRS").path("Error");
            if (!err.isMissingNode()) {
                throw new IllegalStateException(err.path("DescText").asText("Order operation failed"));
            }
            throw new IllegalStateException("Invalid OrderViewRS");
        }
        return mapOrderToBooking(order);
    }

    public ObjectNode toPaymentOrderChangeRq(PaymentRequest req) {
        ObjectNode root = mapper.createObjectNode();
        root.put("_ndcChangeType", "payment");
        ObjectNode rq = root.putObject("IATA_OrderChangeRQ");
        ObjectNode change = rq.putObject("Request").putObject("OrderChange");
        change.putObject("Order").put("OrderID", req.getBookingId());
        ObjectNode pay = change.putArray("PaymentFunctions").addObject();
        pay.put("Amount", req.getAmount());
        pay.put("Currency", req.getCurrency());
        pay.put("PaymentMethod", req.getPaymentMethod());
        return root;
    }

    public PaymentResponse fromPaymentRs(JsonNode root) {
        JsonNode payment = root.path("IATA_OrderViewRS").path("Response").path("Payment");
        PaymentResponse response = new PaymentResponse();
        response.setPaymentId(payment.path("paymentId").asText());
        response.setStatus(payment.path("status").asText());
        response.setBookingId(payment.path("bookingId").asText());
        response.setAmount(new BigDecimal(payment.path("amount").asText("0")));
        response.setCurrency(payment.path("currency").asText("USD"));
        response.setPaymentMethod(payment.path("paymentMethod").asText());
        response.setPaymentDate(parseDateTime(payment.path("paymentDate").asText(null)));
        response.setTransactionId(payment.path("transactionId").asText());
        response.setMessage(payment.path("message").asText());
        return response;
    }

    public ObjectNode toOrderRetrieveRq(OrderQueryRequest req) {
        ObjectNode root = mapper.createObjectNode();
        ObjectNode rq = root.putObject("IATA_OrderRetrieveRQ");
        ObjectNode order = rq.putObject("Request").putObject("OrderValidationFilterCriteria");
        order.put("BookingRefID", req.getConfirmationNumber());
        order.put("PassengerLastName", req.getPassengerLastName());
        return root;
    }

    public ObjectNode toOrderCancelRq(RefundRequest req) {
        ObjectNode root = mapper.createObjectNode();
        ObjectNode rq = root.putObject("IATA_OrderCancelRQ");
        ObjectNode order = rq.putObject("Request").putObject("Order");
        if (req.getBookingId() != null) order.put("OrderID", req.getBookingId());
        if (req.getConfirmationNumber() != null) order.put("BookingRefID", req.getConfirmationNumber());
        order.put("PassengerLastName", req.getPassengerLastName());
        order.put("RefundReason", req.getRefundReason());
        return root;
    }

    public RefundResponse fromRefundRs(JsonNode root) {
        JsonNode refund = root.path("IATA_OrderViewRS").path("Response").path("Refund");
        RefundResponse response = new RefundResponse();
        response.setRefundId(refund.path("refundId").asText(null));
        response.setBookingId(refund.path("bookingId").asText(null));
        response.setConfirmationNumber(refund.path("confirmationNumber").asText(null));
        response.setStatus(refund.path("status").asText());
        if (refund.has("refundAmount")) {
            response.setRefundAmount(new BigDecimal(refund.path("refundAmount").asText()));
        }
        response.setCurrency(refund.path("currency").asText(null));
        if (refund.has("cancellationFee")) {
            response.setCancellationFee(new BigDecimal(refund.path("cancellationFee").asText()));
        }
        if (refund.has("netRefundAmount")) {
            response.setNetRefundAmount(new BigDecimal(refund.path("netRefundAmount").asText()));
        }
        response.setRefundMethod(refund.path("refundMethod").asText(null));
        response.setRefundDate(parseDateTime(refund.path("refundDate").asText(null)));
        response.setMessage(refund.path("message").asText(null));
        response.setFailureReason(refund.path("failureReason").asText(null));
        if (refund.has("estimatedRefundDays")) {
            response.setEstimatedRefundDays(refund.path("estimatedRefundDays").asInt());
        }
        return response;
    }

    public ObjectNode toFlightChangeRq(ChangeFlightRequest req) {
        ObjectNode root = mapper.createObjectNode();
        ObjectNode rq = root.putObject("IATA_OrderChangeRQ");
        ObjectNode change = rq.putObject("Request").putObject("OrderChange");
        if (req.getOriginalBookingId() != null) change.put("OriginalBookingID", req.getOriginalBookingId());
        if (req.getConfirmationNumber() != null) change.put("ConfirmationNumber", req.getConfirmationNumber());
        change.put("PassengerLastName", req.getPassengerLastName());
        change.put("ChangeReason", req.getChangeReason());
        ObjectNode selected = change.putObject("SelectedOffer");
        selected.put("OfferRefID", req.getNewFlightId());
        selected.put("OfferItemRefID", req.getNewFareId());
        return root;
    }

    public ChangeFlightResponse fromChangeRs(JsonNode root) {
        JsonNode ch = root.path("IATA_OrderViewRS").path("Response").path("OrderChange");
        ChangeFlightResponse response = new ChangeFlightResponse();
        response.setChangeId(ch.path("changeId").asText(null));
        response.setOriginalBookingId(ch.path("originalBookingId").asText(null));
        response.setNewBookingId(ch.path("newBookingId").asText(null));
        response.setNewConfirmationNumber(ch.path("newConfirmationNumber").asText(null));
        response.setStatus(ch.path("status").asText());
        response.setMessage(ch.path("message").asText(null));
        response.setFailureReason(ch.path("failureReason").asText(null));
        if (ch.has("originalPrice")) response.setOriginalPrice(new BigDecimal(ch.path("originalPrice").asText()));
        if (ch.has("newPrice")) response.setNewPrice(new BigDecimal(ch.path("newPrice").asText()));
        if (ch.has("changeFee")) response.setChangeFee(new BigDecimal(ch.path("changeFee").asText()));
        if (ch.has("priceDifference")) response.setPriceDifference(new BigDecimal(ch.path("priceDifference").asText()));
        if (ch.has("totalAdditionalPayment")) {
            response.setTotalAdditionalPayment(new BigDecimal(ch.path("totalAdditionalPayment").asText()));
        }
        response.setCurrency(ch.path("currency").asText(null));
        response.setChangeDate(parseDateTime(ch.path("changeDate").asText(null)));
        return response;
    }

    public ObjectNode toServiceListRq(BaggageRequest req) {
        ObjectNode root = mapper.createObjectNode();
        ObjectNode rq = root.putObject("IATA_ServiceListRQ");
        ObjectNode order = rq.putObject("Request").putObject("Order");
        if (req.getBookingId() != null) order.put("OrderID", req.getBookingId());
        if (req.getConfirmationNumber() != null) order.put("BookingRefID", req.getConfirmationNumber());
        return root;
    }

    public ObjectNode toBaggageOrderChangeRq(BaggageRequest req) {
        ObjectNode root = mapper.createObjectNode();
        root.put("_ndcChangeType", "baggage");
        ObjectNode rq = root.putObject("IATA_OrderChangeRQ");
        ObjectNode change = rq.putObject("Request").putObject("OrderChange");
        if (req.getBookingId() != null) change.put("bookingId", req.getBookingId());
        if (req.getConfirmationNumber() != null) change.put("confirmationNumber", req.getConfirmationNumber());
        change.put("PassengerLastName", req.getPassengerLastName());
        change.put("PassengerID", req.getPassengerId());
        change.put("AdditionalBags", req.getAdditionalBags());
        change.put("BaggageType", req.getBaggageType());
        if (req.getEquipmentType() != null) change.put("equipmentType", req.getEquipmentType());
        return root;
    }

    public BaggageResponse fromBaggageRs(JsonNode root) {
        JsonNode bag = root.path("IATA_OrderViewRS").path("Response").path("Baggage");
        BaggageResponse response = new BaggageResponse();
        response.setBaggageOrderId(bag.path("baggageOrderId").asText(null));
        response.setBookingId(bag.path("bookingId").asText(null));
        response.setConfirmationNumber(bag.path("confirmationNumber").asText(null));
        response.setPassengerId(bag.path("passengerId").asText(null));
        response.setStatus(bag.path("status").asText());
        response.setMessage(bag.path("message").asText(null));
        response.setFailureReason(bag.path("failureReason").asText(null));
        if (bag.has("totalAmount")) response.setTotalAmount(new BigDecimal(bag.path("totalAmount").asText()));
        response.setCurrency(bag.path("currency").asText(null));
        response.setPurchaseDate(parseDateTime(bag.path("purchaseDate").asText(null)));
        response.setPaymentStatus(bag.path("paymentStatus").asText(null));
        return response;
    }

    public ObjectNode toAirShoppingRqFromChange(ChangeFlightRequest req) {
        FlightSearchRequest search = new FlightSearchRequest();
        search.setFromCity(req.getNewDepartureCity());
        search.setToCity(req.getNewArrivalCity());
        search.setDepartureDate(req.getNewDepartureDate() != null ? req.getNewDepartureDate() : java.time.LocalDate.now().plusDays(1));
        search.setTripType("ONE_WAY");
        search.setCabinClass("ECONOMY");
        return toAirShoppingRq(search);
    }

    private FlightSearchResponse.FlightOption mapOfferToFlight(JsonNode offer) {
        FlightSearchResponse.FlightOption flight = new FlightSearchResponse.FlightOption();
        flight.setFlightId(offer.path("OfferID").asText());
        flight.setAirlineCode(offer.path("OwnerCode").asText("XX"));
        flight.setAirlineName(offer.path("OwnerCode").asText("Airline"));
        JsonNode journey = offer.path("JourneyOverview");
        flight.setFlightNumber(journey.path("FlightNumber").asText());
        JsonNode dep = journey.path("Departure");
        JsonNode arr = journey.path("Arrival");
        flight.setDepartureAirport(dep.path("IATA_LocationCode").asText());
        flight.setDepartureCity(dep.path("CityName").asText(flight.getDepartureAirport()));
        flight.setDepartureTime(parseDateTime(dep.path("DateTime").asText()));
        flight.setArrivalAirport(arr.path("IATA_LocationCode").asText());
        flight.setArrivalCity(arr.path("CityName").asText(flight.getArrivalAirport()));
        flight.setArrivalTime(parseDateTime(arr.path("DateTime").asText()));
        if (flight.getDepartureTime() != null && flight.getArrivalTime() != null) {
            flight.setDurationMinutes((int) java.time.Duration.between(flight.getDepartureTime(), flight.getArrivalTime()).toMinutes());
        }
        flight.setFlightType("DIRECT");
        flight.setHasWifi(true);
        flight.setHasPowerOutlet(true);
        flight.setCo2Emission("7% less CO2e than typical");
        List<FlightSearchResponse.FareOption> fares = new ArrayList<>();
        JsonNode items = offer.path("OfferItem");
        if (items.isArray()) {
            for (JsonNode item : items) {
                fares.add(mapOfferItem(item, flight.getAirlineName()));
            }
        }
        flight.setFareOptions(fares);
        return flight;
    }

    private FlightSearchResponse.FareOption mapOfferItem(JsonNode item, String provider) {
        FlightSearchResponse.FareOption fare = new FlightSearchResponse.FareOption();
        fare.setFareId(item.path("OfferItemID").asText());
        fare.setProviderName(provider);
        JsonNode price = item.path("Price").path("TotalAmount");
        fare.setPrice(new BigDecimal(price.path("Value").asText("0")));
        fare.setCurrency(price.path("CurCode").asText("USD"));
        JsonNode detail = item.path("FareDetail");
        fare.setCabinClass(detail.path("CabinClass").asText("ECONOMY"));
        fare.setFareBrand(detail.path("FareBrand").asText("Standard"));
        fare.setDescription(fare.getFareBrand());
        fare.setRating(5);
        fare.setReviewCount(500);
        fare.setRecommended(false);
        FlightSearchResponse.BaggageInfo baggage = new FlightSearchResponse.BaggageInfo();
        baggage.setCabinBags(1);
        baggage.setCheckedBags(1);
        baggage.setCabinBagIncluded(true);
        baggage.setCheckedBagIncluded(true);
        fare.setBaggageInfo(baggage);
        return fare;
    }

    private FlightSearchResponse.SearchSummary mapSummary(JsonNode summary, int count) {
        FlightSearchResponse.SearchSummary s = new FlightSearchResponse.SearchSummary();
        s.setTotalResults(summary.path("totalResults").asInt(count));
        s.setSortBy(summary.path("sortBy").asText("Best"));
        if (summary.has("lowestPrice")) s.setLowestPrice(new BigDecimal(summary.path("lowestPrice").asText()));
        if (summary.has("highestPrice")) s.setHighestPrice(new BigDecimal(summary.path("highestPrice").asText()));
        s.setDatePrices(mapDatePrices(summary.path("datePrices")));
        return s;
    }

    private List<FlightSearchResponse.DatePrice> mapDatePrices(JsonNode datePrices) {
        if (!datePrices.isArray()) {
            return List.of();
        }
        List<FlightSearchResponse.DatePrice> list = new ArrayList<>();
        for (JsonNode dp : datePrices) {
            FlightSearchResponse.DatePrice item = new FlightSearchResponse.DatePrice();
            item.setDate(dp.path("date").asText());
            if (dp.has("minPrice")) {
                item.setMinPrice(new BigDecimal(dp.path("minPrice").asText()));
            }
            item.setSelected(dp.path("selected").asBoolean(false));
            list.add(item);
        }
        return list;
    }

    private FlightSearchResponse.SearchSummary defaultSummary(List<FlightSearchResponse.FlightOption> flights) {
        FlightSearchResponse.SearchSummary s = new FlightSearchResponse.SearchSummary();
        s.setTotalResults(flights.size());
        s.setSortBy("Best");
        BigDecimal min = flights.stream()
                .flatMap(f -> f.getFareOptions().stream())
                .map(FlightSearchResponse.FareOption::getPrice)
                .min(BigDecimal::compareTo)
                .orElse(BigDecimal.ZERO);
        BigDecimal max = flights.stream()
                .flatMap(f -> f.getFareOptions().stream())
                .map(FlightSearchResponse.FareOption::getPrice)
                .max(BigDecimal::compareTo)
                .orElse(BigDecimal.ZERO);
        s.setLowestPrice(min);
        s.setHighestPrice(max);
        if (!flights.isEmpty() && flights.get(0).getDepartureTime() != null) {
            s.setDatePrices(defaultDatePrices(flights.get(0).getDepartureTime().toLocalDate().toString(), min));
        }
        return s;
    }

    private List<FlightSearchResponse.DatePrice> defaultDatePrices(String departureDate, BigDecimal minPrice) {
        List<FlightSearchResponse.DatePrice> list = new ArrayList<>();
        java.time.LocalDate base = java.time.LocalDate.parse(departureDate);
        java.time.format.DateTimeFormatter fmt = java.time.format.DateTimeFormatter.ofPattern("dd MMM", java.util.Locale.ENGLISH);
        for (int i = 0; i < 6; i++) {
            FlightSearchResponse.DatePrice dp = new FlightSearchResponse.DatePrice();
            dp.setDate(base.plusDays(i).format(fmt));
            dp.setMinPrice(minPrice);
            dp.setSelected(i == 0);
            list.add(dp);
        }
        return list;
    }

    private BookingResponse mapOrderToBooking(JsonNode order) {
        BookingResponse booking = new BookingResponse();
        booking.setBookingId(order.path("OrderID").asText());
        booking.setConfirmationNumber(order.path("BookingRefID").asText());
        booking.setStatus(order.path("StatusCode").asText("CONFIRMED"));
        booking.setBookingDate(parseDateTime(order.path("CreationDateTime").asText(null)));
        JsonNode fi = order.path("FlightInfo");
        if (!fi.isMissingNode()) {
            BookingResponse.FlightInfo flightInfo = new BookingResponse.FlightInfo();
            flightInfo.setFlightId(fi.path("flightId").asText());
            flightInfo.setFlightNumber(fi.path("flightNumber").asText());
            flightInfo.setDepartureAirport(fi.path("departureAirport").asText());
            flightInfo.setDepartureCity(fi.path("departureCity").asText());
            flightInfo.setDepartureTime(parseDateTime(fi.path("departureTime").asText(null)));
            flightInfo.setArrivalAirport(fi.path("arrivalAirport").asText());
            flightInfo.setArrivalCity(fi.path("arrivalCity").asText());
            flightInfo.setArrivalTime(parseDateTime(fi.path("arrivalTime").asText(null)));
            flightInfo.setCabinClass(fi.path("cabinClass").asText());
            booking.setFlightInfo(flightInfo);
        }
        JsonNode passengers = order.path("Passengers");
        if (passengers.isArray()) {
            List<BookingResponse.PassengerInfo> list = new ArrayList<>();
            for (JsonNode p : passengers) {
                BookingResponse.PassengerInfo pi = new BookingResponse.PassengerInfo();
                pi.setPassengerId(p.path("passengerId").asText());
                pi.setPassengerType(p.path("passengerType").asText());
                pi.setFirstName(p.path("firstName").asText());
                pi.setLastName(p.path("lastName").asText());
                pi.setDocumentType(p.path("documentType").asText());
                pi.setDocumentNumber(p.path("documentNumber").asText());
                pi.setSeatNumber(p.path("seatNumber").asText());
                pi.setMealPreference(p.path("mealPreference").asText());
                list.add(pi);
            }
            booking.setPassengers(list);
        }
        JsonNode pay = order.path("PaymentInfo");
        if (!pay.isMissingNode()) {
            BookingResponse.PaymentInfo paymentInfo = new BookingResponse.PaymentInfo();
            paymentInfo.setPaymentId(pay.path("paymentId").asText());
            if (pay.has("amount")) paymentInfo.setAmount(new BigDecimal(pay.path("amount").asText()));
            paymentInfo.setCurrency(pay.path("currency").asText("USD"));
            paymentInfo.setPaymentMethod(pay.path("paymentMethod").asText());
            paymentInfo.setPaymentStatus(pay.path("paymentStatus").asText());
            paymentInfo.setPaymentDate(parseDateTime(pay.path("paymentDate").asText(null)));
            booking.setPaymentInfo(paymentInfo);
        }
        return booking;
    }

    private LocalDateTime parseDateTime(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return LocalDateTime.parse(value, ISO);
        } catch (Exception e) {
            return LocalDateTime.parse(value.substring(0, Math.min(19, value.length())), ISO);
        }
    }
}
