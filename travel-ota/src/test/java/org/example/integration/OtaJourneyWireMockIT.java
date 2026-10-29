package org.example.integration;

import com.github.tomakehurst.wiremock.junit5.WireMockExtension;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static com.github.tomakehurst.wiremock.client.WireMock.moreThanOrExactly;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.example.support.WireMockNdcFixtures.stubNdcPost;
import static org.example.support.WireMockNdcFixtures.stubNdcPostMatchingBody;
import static org.example.support.WireMockNdcFixtures.stubNdcPostServerError;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * End-to-end OTA journey against a WireMock NDC upstream, using the Softprobe refund session IDs
 * ({@code BK1784828900553} / {@code L5AB90} / {@code Visitor}) as the rigid booking identity.
 */
@SpringBootTest
@AutoConfigureMockMvc
class OtaJourneyWireMockIT {

    private static final String BOOKING_ID = "BK1784828900553";
    private static final String CONFIRMATION = "L5AB90";
    private static final String LAST_NAME = "Visitor";

    @RegisterExtension
    static final WireMockExtension ndc = WireMockExtension.newInstance()
            .options(wireMockConfig().dynamicPort())
            .build();

    @DynamicPropertySource
    static void airlineBaseUrl(DynamicPropertyRegistry registry) {
        registry.add("app.airline.base-url", () -> ndc.baseUrl() + "/ndc/v21.3");
        registry.add("app.mock.search-delay", () -> "0");
        registry.add("app.mock.booking-delay", () -> "0");
        registry.add("app.mock.payment-delay", () -> "0");
    }

    @Autowired
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        ndc.resetAll();
    }

    @Test
    @DisplayName("Search applies MEA regional tax on WireMock NDC fares (RestTemplate)")
    void searchAppliesMeaRegionalTax() throws Exception {
        stubNdcPost(ndc, "/airshopping", "wiremock/ndc/airshopping-sfo-lax.json");

        mockMvc.perform(post("/api/flights/search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "fromCity": "SFO",
                                  "toCity": "LAX",
                                  "departureDate": "2026-10-01",
                                  "tripType": "ONE_WAY",
                                  "passengerInfo": {"adults": 1, "children": 0, "infants": 0},
                                  "cabinClass": "ECONOMY"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flights", hasSize(1)))
                .andExpect(jsonPath("$.flights[0].flightId", is("FL-WIREMOCK-001")))
                .andExpect(jsonPath("$.flights[0].fareOptions[0].price", is(108.0)))
                .andExpect(jsonPath("$.flights[0].fareOptions[1].price", is(889.92)));

        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/airshopping")));
    }

    @Test
    @DisplayName("Book creates Softprobe-session booking via offerprice + ordercreate")
    void bookCreatesSessionBooking() throws Exception {
        stubNdcPost(ndc, "/offerprice", "wiremock/ndc/offerprice-ok.json");
        stubNdcPost(ndc, "/ordercreate", "wiremock/ndc/ordercreate-ok.json");

        mockMvc.perform(post("/api/flights/book")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "flightId": "FL-WIREMOCK-001",
                                  "fareId": "FARE-WIREMOCK-STANDARD",
                                  "passengers": [{
                                    "passengerType": "ADULT",
                                    "firstName": "Demo",
                                    "lastName": "Visitor",
                                    "documentType": "PASSPORT",
                                    "documentNumber": "P1234567",
                                    "nationality": "US"
                                  }],
                                  "contactInfo": {
                                    "phone": "+1-555-0100",
                                    "email": "visitor@example.com"
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingId", is(BOOKING_ID)))
                .andExpect(jsonPath("$.confirmationNumber", is(CONFIRMATION)))
                .andExpect(jsonPath("$.status", is("CONFIRMED")))
                .andExpect(jsonPath("$.passengers[0].lastName", is(LAST_NAME)));

        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/offerprice")));
        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/ordercreate")));
    }

    @Test
    @DisplayName("Pay-and-issue tickets the Softprobe session booking (Feign)")
    void payAndIssueTicketsBooking() throws Exception {
        stubNdcPostMatchingBody(
                ndc, "/orderchange", "_ndcChangeType", "wiremock/ndc/orderchange-payment-ok.json");

        mockMvc.perform(post("/api/flights/payandissue")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "bookingId": "BK1784828900553",
                                  "paymentMethod": "CREDIT_CARD",
                                  "amount": 824,
                                  "currency": "USD",
                                  "paymentDetails": {
                                    "cardNumber": "4111111111111111",
                                    "cardHolderName": "Demo Visitor",
                                    "expiryDate": "12/28",
                                    "cvv": "123"
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.paymentId", is("PAY-WIREMOCK-001")))
                .andExpect(jsonPath("$.status", is("SUCCESS")))
                .andExpect(jsonPath("$.bookingId", is(BOOKING_ID)))
                .andExpect(jsonPath("$.amount", is(824)))
                .andExpect(jsonPath("$.transactionId", is("TXN-WIREMOCK-001")));

        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/orderchange")));
    }

    @Test
    @DisplayName("Order query retrieves Softprobe session booking (WebClient)")
    void queryOrderRetrievesSessionBooking() throws Exception {
        stubNdcPost(ndc, "/orderretrieve", "wiremock/ndc/orderretrieve-ok.json");

        mockMvc.perform(post("/api/flights/orders/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "confirmationNumber": "L5AB90",
                                  "passengerLastName": "Visitor"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingId", is(BOOKING_ID)))
                .andExpect(jsonPath("$.confirmationNumber", is(CONFIRMATION)))
                .andExpect(jsonPath("$.status", is("TICKETED")))
                .andExpect(jsonPath("$.paymentInfo.paymentStatus", is("PAID")));

        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/orderretrieve")));
    }

    @Test
    @DisplayName("Change flight re-shops and changes order (JDK URLConnection + Apache3)")
    void changeFlightUpdatesBooking() throws Exception {
        stubNdcPost(ndc, "/airshopping", "wiremock/ndc/airshopping-sfo-lax.json");
        stubNdcPost(ndc, "/orderchange", "wiremock/ndc/orderchange-flight-change-ok.json");

        mockMvc.perform(post("/api/flights/change")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "originalBookingId": "BK1784828900553",
                                  "confirmationNumber": "L5AB90",
                                  "newFlightId": "FL-WIREMOCK-001",
                                  "newFareId": "FARE-WIREMOCK-STANDARD",
                                  "changeReason": "PERSONAL_REASON",
                                  "passengerLastName": "Visitor",
                                  "newDepartureCity": "SFO",
                                  "newArrivalCity": "LAX",
                                  "newDepartureDate": "2026-10-08"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.changeId", is("CHG-WIREMOCK-001")))
                .andExpect(jsonPath("$.status", is("SUCCESS")))
                .andExpect(jsonPath("$.newBookingId", is("BK1784828900999")))
                .andExpect(jsonPath("$.totalAdditionalPayment", is(126)));

        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/airshopping")));
        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/orderchange")));
    }

    @Test
    @DisplayName("Baggage purchase lists services then order-changes (OkHttp + Apache4 async)")
    void purchaseBaggageAddsCheckedBag() throws Exception {
        stubNdcPost(ndc, "/servicelist", "wiremock/ndc/servicelist-ok.json");
        stubNdcPostMatchingBody(
                ndc,
                "/orderchange",
                "\"_ndcChangeType\":\"baggage\"",
                "wiremock/ndc/orderchange-baggage-ok.json");

        mockMvc.perform(post("/api/flights/baggage/purchase")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "bookingId": "BK1784828900553",
                                  "confirmationNumber": "L5AB90",
                                  "passengerLastName": "Visitor",
                                  "passengerId": "PAX-001",
                                  "additionalBags": 1,
                                  "baggageType": "CHECKED"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.baggageOrderId", is("BAG-WIREMOCK-001")))
                .andExpect(jsonPath("$.status", is("SUCCESS")))
                .andExpect(jsonPath("$.totalAmount", is(45)))
                .andExpect(jsonPath("$.paymentStatus", is("PAID")));

        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/servicelist")));
        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/orderchange")));
    }

    @Test
    @DisplayName("Full Softprobe-style journey: search → book → pay → query → baggage → refund")
    void fullJourneyThroughSoftprobeSessionIds() throws Exception {
        stubNdcPost(ndc, "/airshopping", "wiremock/ndc/airshopping-sfo-lax.json");
        stubNdcPost(ndc, "/offerprice", "wiremock/ndc/offerprice-ok.json");
        stubNdcPost(ndc, "/ordercreate", "wiremock/ndc/ordercreate-ok.json");
        stubNdcPostMatchingBody(
                ndc,
                "/orderchange",
                "\"_ndcChangeType\":\"payment\"",
                "wiremock/ndc/orderchange-payment-ok.json");
        stubNdcPost(ndc, "/orderretrieve", "wiremock/ndc/orderretrieve-ok.json");
        stubNdcPost(ndc, "/servicelist", "wiremock/ndc/servicelist-ok.json");
        stubNdcPostMatchingBody(
                ndc,
                "/orderchange",
                "\"_ndcChangeType\":\"baggage\"",
                "wiremock/ndc/orderchange-baggage-ok.json");
        stubNdcPost(ndc, "/ordercancel", "wiremock/ndc/ordercancel-refund-success.json");

        mockMvc.perform(post("/api/flights/search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "fromCity": "SFO",
                                  "toCity": "LAX",
                                  "departureDate": "2026-10-01",
                                  "tripType": "ONE_WAY",
                                  "passengerInfo": {"adults": 1, "children": 0, "infants": 0},
                                  "cabinClass": "ECONOMY"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flights[0].flightId", is("FL-WIREMOCK-001")));

        mockMvc.perform(post("/api/flights/book")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "flightId": "FL-WIREMOCK-001",
                                  "fareId": "FARE-WIREMOCK-STANDARD",
                                  "passengers": [{
                                    "passengerType": "ADULT",
                                    "firstName": "Demo",
                                    "lastName": "Visitor",
                                    "documentType": "PASSPORT",
                                    "documentNumber": "P1234567",
                                    "nationality": "US"
                                  }],
                                  "contactInfo": {
                                    "phone": "+1-555-0100",
                                    "email": "visitor@example.com"
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingId", is(BOOKING_ID)))
                .andExpect(jsonPath("$.confirmationNumber", is(CONFIRMATION)));

        mockMvc.perform(post("/api/flights/payandissue")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "bookingId": "BK1784828900553",
                                  "paymentMethod": "CREDIT_CARD",
                                  "amount": 824,
                                  "currency": "USD",
                                  "paymentDetails": {
                                    "cardNumber": "4111111111111111",
                                    "cardHolderName": "Demo Visitor",
                                    "expiryDate": "12/28",
                                    "cvv": "123"
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("SUCCESS")));

        mockMvc.perform(post("/api/flights/orders/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "confirmationNumber": "L5AB90",
                                  "passengerLastName": "Visitor"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("TICKETED")));

        mockMvc.perform(post("/api/flights/baggage/purchase")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "bookingId": "BK1784828900553",
                                  "confirmationNumber": "L5AB90",
                                  "passengerLastName": "Visitor",
                                  "passengerId": "PAX-001",
                                  "additionalBags": 1,
                                  "baggageType": "CHECKED"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("SUCCESS")));

        mockMvc.perform(post("/api/flights/refund/process")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "bookingId": "BK1784828900553",
                                  "confirmationNumber": "L5AB90",
                                  "refundReason": "PERSONAL_REASON",
                                  "passengerLastName": "Visitor"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.refundId", is("RF1784828902457")))
                .andExpect(jsonPath("$.netRefundAmount", is(576.8)));

        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/airshopping")));
        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/offerprice")));
        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/ordercreate")));
        ndc.verify(moreThanOrExactly(2), postRequestedFor(urlPathEqualTo("/ndc/v21.3/orderchange")));
        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/orderretrieve")));
        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/servicelist")));
        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/ordercancel")));
    }

    @Test
    @DisplayName("Search returns OTA error envelope when NDC upstream is 500")
    void searchSurfacesUpstreamFailure() throws Exception {
        stubNdcPostServerError(ndc, "/airshopping");

        mockMvc.perform(post("/api/flights/search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "fromCity": "SFO",
                                  "toCity": "LAX",
                                  "departureDate": "2026-10-01",
                                  "tripType": "ONE_WAY",
                                  "passengerInfo": {"adults": 1, "children": 0, "infants": 0},
                                  "cabinClass": "ECONOMY"
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", is("Flight search failed")));
    }
}
