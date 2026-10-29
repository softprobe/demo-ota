package org.example.config;

import com.github.tomakehurst.wiremock.junit5.WireMockExtension;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.example.support.WireMockNdcFixtures.stubNdcPost;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class RegionTenantCodeConfigTest {

    @RegisterExtension
    static final WireMockExtension ndc = WireMockExtension.newInstance()
            .options(wireMockConfig().dynamicPort())
            .build();

    @DynamicPropertySource
    static void airlineBaseUrl(DynamicPropertyRegistry registry) {
        registry.add("app.airline.base-url", () -> ndc.baseUrl() + "/ndc/v21.3");
        registry.add("tenant.sales-region", () -> "MEA");
    }

    @Autowired
    private MockMvc mockMvc;

    @BeforeEach
    void stubAirlineSearch() {
        ndc.resetAll();
        stubNdcPost(ndc, "/airshopping", "wiremock/ndc/airshopping-sfo-lax.json");
    }

    /** MEA sales-region → 8% tax; API shape unchanged, only fare price differs from airline base. */
    @Test
    void searchAppliesMeaRegionalTaxFromConfig() throws Exception {
        mockMvc.perform(post("/api/flights/search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "fromCity": "SFO",
                                  "toCity": "LAX",
                                  "departureDate": "2026-06-01",
                                  "tripType": "ONE_WAY",
                                  "passengerInfo": {"adults": 1, "children": 0, "infants": 0},
                                  "cabinClass": "ECONOMY"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flights[0].fareOptions[0].price", is(108.0)));
    }
}
