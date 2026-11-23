package org.example.config;

import org.example.model.FlightSearchResponse;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * Applies {@link RegionTenantCodeConfig} tax to airline search results in-process only.
 */
@Component
public class RegionalTaxService {

    private static final int MONEY_SCALE = 2;

    public void applyToSearchResponse(FlightSearchResponse response) {
        if (response == null) {
            return;
        }
        BigDecimal rate = RegionTenantCodeConfig.currentRegion().getTaxRate();
        BigDecimal multiplier = BigDecimal.ONE.add(rate);

        List<FlightSearchResponse.FlightOption> flights = response.getFlights();
        if (flights != null) {
            for (FlightSearchResponse.FlightOption flight : flights) {
                if (flight == null || flight.getFareOptions() == null) {
                    continue;
                }
                for (FlightSearchResponse.FareOption fare : flight.getFareOptions()) {
                    if (fare != null && fare.getPrice() != null) {
                        fare.setPrice(withTax(fare.getPrice(), multiplier));
                    }
                }
            }
        }

        FlightSearchResponse.SearchSummary summary = response.getSummary();
        if (summary != null) {
            if (summary.getLowestPrice() != null) {
                summary.setLowestPrice(withTax(summary.getLowestPrice(), multiplier));
            }
            if (summary.getHighestPrice() != null) {
                summary.setHighestPrice(withTax(summary.getHighestPrice(), multiplier));
            }
            if (summary.getDatePrices() != null) {
                for (FlightSearchResponse.DatePrice dp : summary.getDatePrices()) {
                    if (dp != null && dp.getMinPrice() != null) {
                        dp.setMinPrice(withTax(dp.getMinPrice(), multiplier));
                    }
                }
            }
        }
    }

    private static BigDecimal withTax(BigDecimal base, BigDecimal multiplier) {
        return base.multiply(multiplier).setScale(MONEY_SCALE, RoundingMode.HALF_UP);
    }
}
