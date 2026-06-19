package org.example.ndc;

import org.example.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.example.config.AirlineApiConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class NdcAirlineClient {

    private static final Logger logger = LoggerFactory.getLogger(NdcAirlineClient.class);

    @Autowired
    private RestTemplate restTemplate;

    @Autowired
    private AirlineApiConfig airlineApiConfig;

    @Autowired
    private NdcMapper ndcMapper;

    private final ObjectMapper mapper = new ObjectMapper();

    public FlightSearchResponse searchFlights(FlightSearchRequest request) {
        ObjectNode body = ndcMapper.toAirShoppingRq(request);
        JsonNode rs = post("/airshopping", body);
        return ndcMapper.fromAirShoppingRs(rs);
    }

    public BookingResponse bookFlight(BookingRequest request) {
        post("/offerprice", ndcMapper.toOfferPriceRq(request.getFlightId(), request.getFareId()));
        JsonNode rs = post("/ordercreate", ndcMapper.toOrderCreateRq(request));
        return ndcMapper.fromOrderViewRs(rs);
    }

    public PaymentResponse payAndIssue(PaymentRequest request) {
        JsonNode rs = post("/orderchange", ndcMapper.toPaymentOrderChangeRq(request));
        return ndcMapper.fromPaymentRs(rs);
    }

    public BookingResponse queryOrder(OrderQueryRequest request) {
        JsonNode rs = post("/orderretrieve", ndcMapper.toOrderRetrieveRq(request));
        return ndcMapper.fromOrderViewRs(rs);
    }

    public RefundResponse processRefund(RefundRequest request) {
        JsonNode rs = post("/ordercancel", ndcMapper.toOrderCancelRq(request));
        return ndcMapper.fromRefundRs(rs);
    }

    public ChangeFlightResponse changeFlight(ChangeFlightRequest request) {
        if (request.getNewDepartureCity() != null && request.getNewArrivalCity() != null) {
            post("/airshopping", ndcMapper.toAirShoppingRqFromChange(request));
        }
        JsonNode rs = post("/orderchange", ndcMapper.toFlightChangeRq(request));
        return ndcMapper.fromChangeRs(rs);
    }

    public BaggageResponse purchaseBaggage(BaggageRequest request) {
        post("/servicelist", ndcMapper.toServiceListRq(request));
        JsonNode rs = post("/orderchange", ndcMapper.toBaggageOrderChangeRq(request));
        return ndcMapper.fromBaggageRs(rs);
    }

    private JsonNode post(String path, ObjectNode body) {
        String url = resolveBaseUrl() + path;
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        logger.info("NDC POST {}", url);
        ResponseEntity<JsonNode> response = restTemplate.exchange(
                url, HttpMethod.POST, new HttpEntity<>(body, headers), JsonNode.class);
        JsonNode rs = response.getBody();
        if (rs == null) {
            throw new RuntimeException("Empty NDC response from " + url);
        }
        return rs;
    }

    private String resolveBaseUrl() {
        String base = airlineApiConfig.getBaseUrl();
        if (base == null || base.isBlank()) {
            base = "https://spair.softprobe.ai/ndc/v21.3";
        }
        return base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    }
}
