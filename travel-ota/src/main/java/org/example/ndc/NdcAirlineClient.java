package org.example.ndc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.example.config.AirlineApiConfig;
import org.example.model.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class NdcAirlineClient {

    private static final Logger logger = LoggerFactory.getLogger(NdcAirlineClient.class);
    private static final String DEFAULT_BASE_URL = "https://spair.softprobe.ai/ndc/v21.3";

    private final RestTemplate restTemplate;
    private final AirlineApiConfig airlineApiConfig;
    private final NdcMapper ndcMapper;

    public NdcAirlineClient(
            RestTemplate restTemplate,
            AirlineApiConfig airlineApiConfig,
            NdcMapper ndcMapper) {
        this.restTemplate = restTemplate;
        this.airlineApiConfig = airlineApiConfig;
        this.ndcMapper = ndcMapper;
    }

    public FlightSearchResponse searchFlights(FlightSearchRequest request) {
        JsonNode response = post("/airshopping", ndcMapper.toAirShoppingRq(request));
        return ndcMapper.fromAirShoppingRs(response);
    }

    public BookingResponse bookFlight(BookingRequest request) {
        post("/offerprice", ndcMapper.toOfferPriceRq(request.getFlightId(), request.getFareId()));
        JsonNode response = post("/ordercreate", ndcMapper.toOrderCreateRq(request));
        return ndcMapper.fromOrderViewRs(response);
    }

    public PaymentResponse payAndIssue(PaymentRequest request) {
        JsonNode response = post("/orderchange", ndcMapper.toPaymentOrderChangeRq(request));
        return ndcMapper.fromPaymentRs(response);
    }

    public BookingResponse queryOrder(OrderQueryRequest request) {
        JsonNode response = post("/orderretrieve", ndcMapper.toOrderRetrieveRq(request));
        return ndcMapper.fromOrderViewRs(response);
    }

    public RefundResponse processRefund(RefundRequest request) {
        JsonNode response = post("/ordercancel", ndcMapper.toOrderCancelRq(request));
        return ndcMapper.fromRefundRs(response);
    }

    public ChangeFlightResponse changeFlight(ChangeFlightRequest request) {
        if (request.getNewDepartureCity() != null && request.getNewArrivalCity() != null) {
            post("/airshopping", ndcMapper.toAirShoppingRqFromChange(request));
        }
        JsonNode response = post("/orderchange", ndcMapper.toFlightChangeRq(request));
        return ndcMapper.fromChangeRs(response);
    }

    public BaggageResponse purchaseBaggage(BaggageRequest request) {
        post("/servicelist", ndcMapper.toServiceListRq(request));
        JsonNode response = post("/orderchange", ndcMapper.toBaggageOrderChangeRq(request));
        return ndcMapper.fromBaggageRs(response);
    }

    private JsonNode post(String path, ObjectNode body) {
        String url = baseUrl() + path;
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<JsonNode> response = restTemplate.postForEntity(
                url, new HttpEntity<>(body, headers), JsonNode.class);
        JsonNode responseBody = response.getBody();
        if (responseBody == null || responseBody.isNull()) {
            throw new IllegalStateException("Empty NDC response from " + url);
        }
        logger.info("NDC POST {}", url);
        return responseBody;
    }

    private String baseUrl() {
        String baseUrl = airlineApiConfig.getBaseUrl();
        if (baseUrl == null || baseUrl.isBlank()) {
            baseUrl = DEFAULT_BASE_URL;
        }
        return baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }
}
