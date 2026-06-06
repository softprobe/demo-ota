package org.example.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

/**
 * Demo of the {@code @Value}-on-setter → static field → inner enum snapshot pattern
 * exercised by sp-agent-java Spring config replay.
 *
 * <p>Search applies {@linkplain #currentRegion() regional tax} to fare prices internally;
 * nothing about tenants or tax is exposed on the public search API.</p>
 */
@Component
public class RegionTenantCodeConfig {

    public static String TENANTCODE_MEA;
    public static String TENANTCODE_EU;
    /** Active sales region (MEA / EU); replay can inject a different value than at record time. */
    public static String SALES_REGION;

    @Value("${tenant.MEA}")
    private void setMea(String value) {
        TENANTCODE_MEA = value;
    }

    @Value("${tenant.EU}")
    private void setEu(String value) {
        TENANTCODE_EU = value;
    }

    @Value("${tenant.sales-region:MEA}")
    private void setSalesRegion(String value) {
        SALES_REGION = value;
    }

    public static Region currentRegion() {
        String key = SALES_REGION != null ? SALES_REGION.trim() : "MEA";
        try {
            return Region.valueOf(key.toUpperCase());
        } catch (IllegalArgumentException ignored) {
            return Region.MEA;
        }
    }

    public enum Region {
        MEA(TENANTCODE_MEA, "0.08"),
        EU(TENANTCODE_EU, "0.20");

        private final String tenantCode;
        private final BigDecimal taxRate;

        Region(String tenantCode, String taxRate) {
            this.tenantCode = tenantCode;
            this.taxRate = new BigDecimal(taxRate);
        }

        public String getTenantCode() {
            return tenantCode;
        }

        /** VAT/sales tax applied to airline base fares before returning search results. */
        public BigDecimal getTaxRate() {
            return taxRate;
        }
    }
}
