package org.example.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.junit5.WireMockExtension;
import com.zaxxer.hikari.HikariDataSource;
import org.example.config.OtaDataSourceConfig;
import org.example.model.BookingRequest;
import org.example.service.FlightService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.containing;
import static com.github.tomakehurst.wiremock.client.WireMock.exactly;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.example.support.WireMockNdcFixtures.stubDownstreamSandbox;
import static org.example.support.WireMockNdcFixtures.stubNdcPost;
import static org.example.support.WireMockNdcFixtures.stubNdcPostBody;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class BookingSessionIntegrationTest {

    @RegisterExtension
    static final WireMockExtension upstream = WireMockExtension.newInstance()
            .options(wireMockConfig().dynamicPort())
            .build();

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("app.airline.base-url", () -> upstream.baseUrl() + "/ndc/v21.3");
        registry.add("app.payment.base-url", upstream::baseUrl);
        registry.add("app.notification.base-url", upstream::baseUrl);
        registry.add("tenant.sales-region", () -> "MEA");
        registry.add("app.mock.search-delay", () -> "0");
        registry.add("app.mock.booking-delay", () -> "0");
        registry.add("app.mock.payment-delay", () -> "0");
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private FlightService flightService;

    private final ObjectMapper mapper = new ObjectMapper();
    private String travelDate;

    @BeforeEach
    void setUp() {
        upstream.resetAll();
        stubDownstreamSandbox(upstream);
        travelDate = LocalDate.now(ZoneOffset.UTC).plusDays(14).toString();
    }

    @Test
    @DisplayName("GET auto-initializes an empty session view with TRV-01 policy and explicit nulls")
    void emptySessionViewHasPolicyAndNullFields() throws Exception {
        mockMvc.perform(get("/api/bookings/sessions/ses_empty_1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionId", is("ses_empty_1")))
                .andExpect(jsonPath("$.offers", hasSize(0)))
                .andExpect(jsonPath("$.pending").value(nullValue()))
                .andExpect(jsonPath("$.booking").value(nullValue()))
                .andExpect(jsonPath("$.travelPolicy.ruleId", is("TRV-01")))
                .andExpect(jsonPath("$.travelPolicy.threshold", is(1000)))
                .andExpect(jsonPath("$.travelPolicy.currency", is("USD")));
    }

    @Test
    @DisplayName("Search returns 200 for supported route and 400 for invalid airport or past/invalid date")
    void searchValidatesArgumentsAndPersistsOffers() throws Exception {
        stubAirShopping(travelDate);

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/ses_search_1/tools/search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"origin":"LHR","destination":"CDG","date":"%s"}
                                """.formatted(travelDate)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.offers", hasSize(2)))
                .andExpect(jsonPath("$.offers[0].id", is("FL-LOW:FARE-LOW")))
                .andExpect(jsonPath("$.offers[0].total", is(540)))
                .andExpect(jsonPath("$.offers[1].id", is("FL-HIGH:FARE-HIGH")))
                .andExpect(jsonPath("$.offers[1].total", is(1296)));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/ses_search_1/tools/search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"origin":"SFO","destination":"CDG","date":"%s"}
                                """.formatted(travelDate)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", is("Use one of the supported European airport codes.")));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/ses_search_1/tools/search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"origin":"LHR","destination":"LHR","date":"%s"}
                                """.formatted(travelDate)))
                .andExpect(status().isBadRequest());

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/ses_search_1/tools/search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"origin":"LHR","destination":"CDG","date":"2020-01-01"}
                                """))
                .andExpect(status().isBadRequest());

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/ses_search_1/tools/search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"origin":"LHR","destination":"CDG","date":"2027-02-31"}
                                """))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("Compliant fare (<= $1000): prepare -> approve -> book -> order -> pay -> cancel rules")
    void compliantFareFullBookingAndPaymentLifecycle() throws Exception {
        String sessionId = "ses_compliant_1";
        stubAirShopping(travelDate);
        stubNdcPost(upstream, "/offerprice", "wiremock/ndc/offerprice-ok.json");
        stubOrderCreateAndRetrieve(
                "BK-LOW-001", "LOW123", "FL-LOW", "BA304", "LHR", "CDG",
                travelDate + "T09:00:00", travelDate + "T11:15:00",
                "Alex", "Demo", 500, "CONFIRMED", "PENDING", null);

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/tools/search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"origin":"LHR","destination":"CDG","date":"%s"}
                                """.formatted(travelDate)))
                .andExpect(status().isOk());

        MvcResult prepareRes = mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/tools/prepare")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"offerId":"FL-LOW:FARE-LOW","firstName":"Alex","lastName":"Demo"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("awaiting_approval")))
                .andExpect(jsonPath("$.managerApproval.status", is("not_required")))
                .andExpect(jsonPath("$.managerApproval.requestedAt").value(nullValue()))
                .andReturn();
        String requestId = mapper.readTree(prepareRes.getResponse().getContentAsString()).get("id").asText();

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/tools/book")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"requestId":"%s"}
                                """.formatted(requestId)))
                .andExpect(status().isConflict());

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/approve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"requestId":"%s","injectSilentBug":false}
                                """.formatted(requestId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accepted", is(true)))
                .andExpect(jsonPath("$.awaitingManagerApproval", is(false)))
                .andExpect(jsonPath("$.pending.status", is("approved")));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/tools/book")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"requestId":"%s"}
                                """.formatted(requestId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified", is(true)))
                .andExpect(jsonPath("$.bookingId", is("BK-LOW-001")))
                .andExpect(jsonPath("$.confirmationNumber", is("LOW123")))
                .andExpect(jsonPath("$.paymentStatus", is("PENDING")))
                .andExpect(jsonPath("$.amount", is(540)));

        upstream.verify(1, postRequestedFor(urlPathEqualTo("/v1/notifications/confirmation"))
                .withRequestBody(containing("BOOKING_CONFIRMED")));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/tools/order")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified", is(true)))
                .andExpect(jsonPath("$.confirmationNumber", is("LOW123")));

        stubPaymentAndPaidOrder(
                "BK-LOW-001", "LOW123", "FL-LOW", "BA304", "LHR", "CDG",
                travelDate + "T09:00:00", travelDate + "T11:15:00",
                "Alex", "Demo", 540, "PAY-LOW-1", "TXN-LOW-1");

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/pay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"requestId":"%s"}
                                """.formatted(requestId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.paid", is(true)))
                .andExpect(jsonPath("$.booking.paymentStatus", is("PAID")))
                .andExpect(jsonPath("$.booking.status", is("TICKETED")))
                .andExpect(jsonPath("$.booking.payment.paymentId", is("PAY-LOW-1")))
                .andExpect(jsonPath("$.booking.payment.apiResponseVerified", is(true)));

        upstream.verify(1, postRequestedFor(urlPathEqualTo("/v1/payments/authorize")));
        upstream.verify(1, postRequestedFor(urlPathEqualTo("/v1/notifications/confirmation"))
                .withRequestBody(containing("TICKET_ISSUED")));

        String dbPayStatus = jdbcTemplate.queryForObject(
                "SELECT payment_status FROM ota_orders WHERE booking_id = ?", String.class, "BK-LOW-001");
        assertEquals("PAID", dbPayStatus);
        Integer paymentRows = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM ota_payments WHERE booking_id = ?", Integer.class, "BK-LOW-001");
        assertEquals(1, paymentRows);
    }

    @Test
    @DisplayName("Over-threshold fare (> $1000) blocks without manager approval, then succeeds with skip_manager_approval")
    void overThresholdPolicyGateAndSilentBugBypass() throws Exception {
        String sessionId = "ses_high_1";
        stubAirShopping(travelDate);
        stubNdcPost(upstream, "/offerprice", "wiremock/ndc/offerprice-ok.json");
        stubOrderCreateAndRetrieve(
                "BK-HIGH-001", "HI9999", "FL-HIGH", "AF108", "LHR", "CDG",
                travelDate + "T14:00:00", travelDate + "T16:15:00",
                "Alex", "Demo", 1200, "CONFIRMED", "PENDING", null);

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/tools/search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"origin":"LHR","destination":"CDG","date":"%s"}
                                """.formatted(travelDate)))
                .andExpect(status().isOk());

        MvcResult prepareRes = mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/tools/prepare")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"offerId":"FL-HIGH:FARE-HIGH","firstName":"Alex","lastName":"Demo"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.managerApproval.status", is("not_requested")))
                .andReturn();
        String requestId = mapper.readTree(prepareRes.getResponse().getContentAsString()).get("id").asText();

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/approve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"requestId":"%s","injectSilentBug":false}
                                """.formatted(requestId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.awaitingManagerApproval", is(true)))
                .andExpect(jsonPath("$.pending.managerApproval.status", is("pending")));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/tools/book")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"requestId":"%s"}
                                """.formatted(requestId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error", is("Manager approval is required before booking. No reservation has been created.")));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/approve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"requestId":"%s","injectSilentBug":true}
                                """.formatted(requestId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.awaitingManagerApproval", is(false)))
                .andExpect(jsonPath("$.pending.demoFault.kind", is("skip_manager_approval")));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/tools/book")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"requestId":"%s"}
                                """.formatted(requestId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified", is(true)))
                .andExpect(jsonPath("$.demoFault.kind", is("skip_manager_approval")))
                .andExpect(jsonPath("$.amount", is(1296)));
    }

    @Test
    @DisplayName("Repeat bookFlight with identical bookingId upserts ota_orders idempotently")
    void repeatBookFlightUpsertsIdempotently() {
        stubNdcPost(upstream, "/offerprice", "wiremock/ndc/offerprice-ok.json");
        stubNdcPost(upstream, "/ordercreate", "wiremock/ndc/ordercreate-ok.json");

        BookingRequest req = new BookingRequest();
        req.setFlightId("FL-WIREMOCK-001");
        req.setFareId("FARE-WIREMOCK-STANDARD");
        BookingRequest.Passenger pax = new BookingRequest.Passenger();
        pax.setPassengerType("ADULT");
        pax.setFirstName("Demo");
        pax.setLastName("Visitor");
        pax.setDocumentType("PASSPORT");
        pax.setDocumentNumber("P1234567");
        pax.setNationality("US");
        req.setPassengers(List.of(pax));
        BookingRequest.ContactInfo contact = new BookingRequest.ContactInfo();
        contact.setPhone("+1-555-0100");
        contact.setEmail("visitor@example.com");
        req.setContactInfo(contact);

        flightService.bookFlight(req);
        flightService.bookFlight(req);

        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM ota_orders WHERE booking_id = ?", Integer.class, "BK1784828900553");
        assertEquals(1, count, "Idempotent upsert must keep a single row per booking_id");
    }

    @Test
    @DisplayName("Cancel discards unsubmitted review and rejects cancelling a completed booking")
    void cancelUnsubmittedReview() throws Exception {
        String sessionId = "ses_cancel_1";
        stubAirShopping(travelDate);
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/tools/search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"origin":"LHR","destination":"CDG","date":"%s"}
                                """.formatted(travelDate)))
                .andExpect(status().isOk());

        MvcResult prep = mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/tools/prepare")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"offerId":"FL-LOW:FARE-LOW","firstName":"Alex","lastName":"Demo"}
                                """))
                .andExpect(status().isOk())
                .andReturn();
        String reqId = mapper.readTree(prep.getResponse().getContentAsString()).get("id").asText();

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/bookings/sessions/" + sessionId + "/cancel")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"requestId":"%s"}
                                """.formatted(reqId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cancelled", is(true)))
                .andExpect(jsonPath("$.pending.status", is("cancelled")));
    }

    @Test
    @DisplayName("OtaDataSourceConfig selects H2 PostgreSQL-mode when blank and org.postgresql.Driver for jdbc:postgresql:")
    void dataSourceConfigSelectsExpectedDriver() {
        OtaDataSourceConfig cfg = new OtaDataSourceConfig();
        HikariDataSource h2 = (HikariDataSource) cfg.dataSource("", "", "");
        try {
            assertEquals("org.h2.Driver", h2.getDriverClassName());
        } finally {
            h2.close();
        }
        HikariDataSource pg = (HikariDataSource) cfg.dataSource("jdbc:postgresql://127.0.0.1:5432/ota", "ota", "secret");
        try {
            assertEquals("org.postgresql.Driver", pg.getDriverClassName());
            assertEquals("ota", pg.getUsername());
        } finally {
            pg.close();
        }
    }

    @Nested
    @SpringBootTest(properties = "app.fault.skip-email=true")
    @AutoConfigureMockMvc
    class SkipEmailFaultTest {

        @Autowired
        private MockMvc skipEmailMockMvc;

        @Test
        @DisplayName("OTA_FAULT_SKIP_EMAIL=true returns 200 on book and pay while sending zero notification requests")
        void skipEmailFaultSkipsConfirmationCalls() throws Exception {
            upstream.resetAll();
            stubDownstreamSandbox(upstream);
            String date = LocalDate.now(ZoneOffset.UTC).plusDays(10).toString();
            stubAirShopping(date);
            stubNdcPost(upstream, "/offerprice", "wiremock/ndc/offerprice-ok.json");
            stubOrderCreateAndRetrieve(
                    "BK-NOEMAIL-1", "NOMAIL", "FL-LOW", "BA304", "LHR", "CDG",
                    date + "T09:00:00", date + "T11:15:00",
                    "Alex", "Demo", 500, "CONFIRMED", "PENDING", null);

            String sessionId = "ses_skip_email_1";
            skipEmailMockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                            .post("/api/bookings/sessions/" + sessionId + "/tools/search")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"origin":"LHR","destination":"CDG","date":"%s"}
                                    """.formatted(date)))
                    .andExpect(status().isOk());

            MvcResult prep = skipEmailMockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                            .post("/api/bookings/sessions/" + sessionId + "/tools/prepare")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"offerId":"FL-LOW:FARE-LOW","firstName":"Alex","lastName":"Demo"}
                                    """))
                    .andExpect(status().isOk())
                    .andReturn();
            JsonNode prepNode = mapper.readTree(prep.getResponse().getContentAsString());
            String reqId = prepNode.get("id").asText();
            double approvedTotal = prepNode.get("offer").get("total").asDouble();

            skipEmailMockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                            .post("/api/bookings/sessions/" + sessionId + "/approve")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"requestId":"%s","injectSilentBug":false}
                                    """.formatted(reqId)))
                    .andExpect(status().isOk());

            skipEmailMockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                            .post("/api/bookings/sessions/" + sessionId + "/tools/book")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"requestId":"%s"}
                                    """.formatted(reqId)))
                    .andExpect(status().isOk());

            stubPaymentAndPaidOrder(
                    "BK-NOEMAIL-1", "NOMAIL", "FL-LOW", "BA304", "LHR", "CDG",
                    date + "T09:00:00", date + "T11:15:00",
                    "Alex", "Demo", approvedTotal, "PAY-NOMAIL-1", "TXN-NOMAIL-1");

            skipEmailMockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                            .post("/api/bookings/sessions/" + sessionId + "/pay")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"requestId":"%s"}
                                    """.formatted(reqId)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.paid", is(true)));

            upstream.verify(1, postRequestedFor(urlPathEqualTo("/v1/payments/authorize")));
            upstream.verify(exactly(0), postRequestedFor(urlPathEqualTo("/v1/notifications/confirmation")));
        }
    }

    private static void stubAirShopping(String date) {
        stubNdcPostBody(upstream, "/airshopping", """
                {
                  "IATA_AirShoppingRS": {
                    "Response": {
                      "OffersGroup": {
                        "CarrierOffers": [
                          {
                            "Offer": {
                              "OfferID": "FL-LOW",
                              "OwnerCode": "BA",
                              "OfferItem": [{
                                "OfferItemID": "FARE-LOW",
                                "Price": { "TotalAmount": { "Value": 500, "CurCode": "USD" } },
                                "FareDetail": { "FareBrand": "Basic", "CabinClass": "ECONOMY" }
                              }],
                              "JourneyOverview": {
                                "FlightNumber": "BA304",
                                "Departure": { "IATA_LocationCode": "LHR", "CityName": "London", "DateTime": "%sT09:00:00" },
                                "Arrival": { "IATA_LocationCode": "CDG", "CityName": "Paris", "DateTime": "%sT11:15:00" }
                              }
                            }
                          },
                          {
                            "Offer": {
                              "OfferID": "FL-HIGH",
                              "OwnerCode": "AF",
                              "OfferItem": [{
                                "OfferItemID": "FARE-HIGH",
                                "Price": { "TotalAmount": { "Value": 1200, "CurCode": "USD" } },
                                "FareDetail": { "FareBrand": "Flex", "CabinClass": "ECONOMY" }
                              }],
                              "JourneyOverview": {
                                "FlightNumber": "AF108",
                                "Departure": { "IATA_LocationCode": "LHR", "CityName": "London", "DateTime": "%sT14:00:00" },
                                "Arrival": { "IATA_LocationCode": "CDG", "CityName": "Paris", "DateTime": "%sT16:15:00" }
                              }
                            }
                          }
                        ]
                      }
                    }
                  }
                }
                """.formatted(date, date, date, date));
    }

    private static void stubOrderCreateAndRetrieve(
            String bookingId,
            String confirmation,
            String flightId,
            String flightNumber,
            String origin,
            String dest,
            String depTime,
            String arrTime,
            String firstName,
            String lastName,
            double amount,
            String statusCode,
            String paymentStatus,
            String paymentId) {
        String orderBody = """
                {
                  "IATA_OrderViewRS": {
                    "Response": {
                      "Order": {
                        "OrderID": "%s",
                        "BookingRefID": "%s",
                        "StatusCode": "%s",
                        "CreationDateTime": "2026-11-23T10:00:00",
                        "FlightInfo": {
                          "flightId": "%s",
                          "flightNumber": "%s",
                          "departureAirport": "%s",
                          "departureCity": "%s",
                          "departureTime": "%s",
                          "arrivalAirport": "%s",
                          "arrivalCity": "%s",
                          "arrivalTime": "%s",
                          "cabinClass": "ECONOMY"
                        },
                        "Passengers": [{
                          "passengerId": "PAX-1",
                          "passengerType": "ADULT",
                          "firstName": "%s",
                          "lastName": "%s",
                          "documentType": "PASSPORT",
                          "documentNumber": "DEMO000001"
                        }],
                        "PaymentInfo": {
                          "paymentId": %s,
                          "amount": %s,
                          "currency": "USD",
                          "paymentMethod": %s,
                          "paymentStatus": "%s",
                          "paymentDate": %s
                        }
                      }
                    }
                  }
                }
                """.formatted(
                bookingId,
                confirmation,
                statusCode,
                flightId,
                flightNumber,
                origin,
                origin,
                depTime,
                dest,
                dest,
                arrTime,
                firstName,
                lastName,
                paymentId == null ? "null" : "\"" + paymentId + "\"",
                amount,
                "PAID".equals(paymentStatus) ? "\"CREDIT_CARD\"" : "null",
                paymentStatus,
                "PAID".equals(paymentStatus) ? "\"2026-11-23T10:05:00\"" : "null");
        stubNdcPostBody(upstream, "/ordercreate", orderBody);
        stubNdcPostBody(upstream, "/orderretrieve", orderBody);
    }

    private static void stubPaymentAndPaidOrder(
            String bookingId,
            String confirmation,
            String flightId,
            String flightNumber,
            String origin,
            String dest,
            String depTime,
            String arrTime,
            String firstName,
            String lastName,
            double amount,
            String paymentId,
            String transactionId) {
        upstream.stubFor(post(urlPathEqualTo("/ndc/v21.3/orderchange"))
                .withRequestBody(containing("_ndcChangeType"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody("""
                                {
                                  "IATA_OrderViewRS": {
                                    "Response": {
                                      "Payment": {
                                        "paymentId": "%s",
                                        "status": "SUCCESS",
                                        "bookingId": "%s",
                                        "amount": %s,
                                        "currency": "USD",
                                        "paymentMethod": "CREDIT_CARD",
                                        "paymentDate": "2026-11-23T10:05:00",
                                        "transactionId": "%s",
                                        "message": "Payment processed and ticket issued"
                                      }
                                    }
                                  }
                                }
                                """.formatted(paymentId, bookingId, amount, transactionId))));
        stubOrderCreateAndRetrieve(
                bookingId,
                confirmation,
                flightId,
                flightNumber,
                origin,
                dest,
                depTime,
                arrTime,
                firstName,
                lastName,
                amount,
                "TICKETED",
                "PAID",
                paymentId);
    }
}
