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

import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.example.support.WireMockNdcFixtures.stubNdcPost;
import static org.example.support.WireMockNdcFixtures.stubNdcPostExactJson;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Rigid refund replay modeled on Softprobe session
 * {@code 0914c87923125aa54c8be5e5c2eb06dd} ({@code /api/orders/refund} → airline refund).
 * Local OTA maps the same contract onto {@code POST /api/flights/refund/process} → NDC {@code /ordercancel}.
 */
@SpringBootTest
@AutoConfigureMockMvc
class RefundProcessWireMockIT {

    @RegisterExtension
    static final WireMockExtension ndc = WireMockExtension.newInstance()
            .options(wireMockConfig().dynamicPort())
            .build();

    @DynamicPropertySource
    static void airlineBaseUrl(DynamicPropertyRegistry registry) {
        registry.add("app.airline.base-url", () -> ndc.baseUrl() + "/ndc/v21.3");
    }

    @Autowired
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        ndc.resetAll();
    }

    @Test
    @DisplayName("Softprobe refund session: PERSONAL_REASON for BK1784828900553 / L5AB90 / Visitor")
    void refundMatchesSoftprobeRecordedSession() throws Exception {
        stubNdcPostExactJson(
                ndc,
                "/ordercancel",
                """
                {
                  "IATA_OrderCancelRQ": {
                    "Request": {
                      "Order": {
                        "OrderID": "BK1784828900553",
                        "BookingRefID": "L5AB90",
                        "PassengerLastName": "Visitor",
                        "RefundReason": "PERSONAL_REASON"
                      }
                    }
                  }
                }
                """,
                "wiremock/ndc/ordercancel-refund-success.json");

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
                .andExpect(jsonPath("$.bookingId", is("BK1784828900553")))
                .andExpect(jsonPath("$.confirmationNumber", is("L5AB90")))
                .andExpect(jsonPath("$.status", is("SUCCESS")))
                .andExpect(jsonPath("$.refundAmount", is(824.0)))
                .andExpect(jsonPath("$.currency", is("USD")))
                .andExpect(jsonPath("$.cancellationFee", is(247.2)))
                .andExpect(jsonPath("$.netRefundAmount", is(576.8)))
                .andExpect(jsonPath("$.refundMethod", is("ORIGINAL_PAYMENT")))
                .andExpect(jsonPath("$.estimatedRefundDays", is(7)))
                .andExpect(jsonPath(
                        "$.message",
                        is("Refund processed successfully. Amount will be credited to your original payment method within 7-10 business days.")));

        ndc.verify(1, postRequestedFor(urlPathEqualTo("/ndc/v21.3/ordercancel")));
    }

    @Test
    @DisplayName("Refund returns FAILED when NDC cannot find the booking")
    void refundPropagatesUpstreamFailureStatus() throws Exception {
        stubNdcPost(ndc, "/ordercancel", "wiremock/ndc/ordercancel-refund-failed.json");

        mockMvc.perform(post("/api/flights/refund/process")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "bookingId": "BK-MISSING",
                                  "confirmationNumber": "ZZZZZZ",
                                  "refundReason": "PERSONAL_REASON",
                                  "passengerLastName": "Visitor"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("FAILED")))
                .andExpect(jsonPath("$.failureReason", is("Booking not found")));
    }

    @Test
    @DisplayName("Refund rejects incomplete request bodies")
    void refundValidationRequiresCoreFields() throws Exception {
        mockMvc.perform(post("/api/flights/refund/process")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "bookingId": "BK1784828900553"
                                }
                                """))
                .andExpect(status().isBadRequest());
    }
}
