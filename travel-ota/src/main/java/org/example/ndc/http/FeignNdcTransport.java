package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import feign.Feign;
import feign.jackson.JacksonDecoder;
import feign.jackson.JacksonEncoder;
import org.example.config.AirlineApiConfig;
import org.springframework.stereotype.Component;

@Component
public class FeignNdcTransport implements NdcHttpTransport {

    private final NdcFeignApi feignApi;

    public FeignNdcTransport(AirlineApiConfig airlineApiConfig) {
        String baseUrl = resolveBaseUrl(airlineApiConfig);
        this.feignApi = Feign.builder()
                .encoder(new JacksonEncoder(NdcJsonSupport.MAPPER))
                .decoder(new JacksonDecoder(NdcJsonSupport.MAPPER))
                .target(NdcFeignApi.class, baseUrl);
    }

    @Override
    public JsonNode post(String url, ObjectNode body) {
        String path = extractPath(url);
        return feignApi.post(path, body);
    }

    private static String extractPath(String url) {
        int idx = url.indexOf("/ndc/");
        if (idx >= 0) {
            String suffix = url.substring(idx);
            int slash = suffix.lastIndexOf('/');
            if (slash >= 0 && slash < suffix.length() - 1) {
                return suffix.substring(slash);
            }
        }
        int lastSlash = url.lastIndexOf('/');
        return lastSlash >= 0 ? url.substring(lastSlash) : url;
    }

    private static String resolveBaseUrl(AirlineApiConfig config) {
        String base = config.getBaseUrl();
        if (base == null || base.isBlank()) {
            base = "https://spair.softprobe.ai/ndc/v21.3";
        }
        return base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    }
}
