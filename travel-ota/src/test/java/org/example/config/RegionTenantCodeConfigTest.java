package org.example.config;

import com.airline.common.model.FlightSearchResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.util.List;

import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class RegionTenantCodeConfigTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private RestTemplate restTemplate;

    @BeforeEach
    void stubAirlineSearch() {
        FlightSearchResponse.FareOption fare = new FlightSearchResponse.FareOption();
        fare.setPrice(new BigDecimal("100.00"));

        FlightSearchResponse.FlightOption flight = new FlightSearchResponse.FlightOption();
        flight.setFareOptions(List.of(fare));

        FlightSearchResponse airlineBody = new FlightSearchResponse();
        airlineBody.setFlights(List.of(flight));

        when(restTemplate.postForEntity(anyString(), any(), eq(FlightSearchResponse.class)))
                .thenReturn(new ResponseEntity<>(airlineBody, HttpStatus.OK));
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
