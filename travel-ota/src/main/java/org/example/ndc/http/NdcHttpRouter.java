package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.example.config.AirlineApiConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.EnumMap;
import java.util.Map;

@Component
public class NdcHttpRouter {

    private static final Logger logger = LoggerFactory.getLogger(NdcHttpRouter.class);

    private final AirlineApiConfig airlineApiConfig;
    private final Map<NdcCallSite, NdcHttpTransport> transports;

    public NdcHttpRouter(
            AirlineApiConfig airlineApiConfig,
            RestTemplateNdcTransport restTemplateTransport,
            Apache4SyncNdcTransport apache4SyncTransport,
            OkHttpNdcTransport okHttpTransport,
            FeignNdcTransport feignTransport,
            WebClientNdcTransport webClientTransport,
            NingNdcTransport ningTransport,
            JdkUrlConnectionNdcTransport jdkTransport,
            Apache3NdcTransport apache3Transport,
            Apache4AsyncNdcTransport apache4AsyncTransport) {
        this.airlineApiConfig = airlineApiConfig;
        this.transports = new EnumMap<>(NdcCallSite.class);
        transports.put(NdcCallSite.SEARCH_AIRSHOPPING, restTemplateTransport);
        transports.put(NdcCallSite.BOOK_OFFER_PRICE, apache4SyncTransport);
        transports.put(NdcCallSite.BOOK_ORDER_CREATE, okHttpTransport);
        transports.put(NdcCallSite.PAY_ORDER_CHANGE, feignTransport);
        transports.put(NdcCallSite.QUERY_ORDER_RETRIEVE, webClientTransport);
        transports.put(NdcCallSite.REFUND_ORDER_CANCEL, ningTransport);
        transports.put(NdcCallSite.CHANGE_AIRSHOPPING, jdkTransport);
        transports.put(NdcCallSite.CHANGE_ORDER_CHANGE, apache3Transport);
        transports.put(NdcCallSite.BAGGAGE_SERVICE_LIST, okHttpTransport);
        transports.put(NdcCallSite.BAGGAGE_ORDER_CHANGE, apache4AsyncTransport);
    }

    public JsonNode post(NdcCallSite callSite, String path, ObjectNode body) {
        NdcHttpTransport transport = transports.get(callSite);
        if (transport == null) {
            throw new IllegalStateException("No HTTP transport configured for " + callSite);
        }
        String url = resolveBaseUrl() + path;
        logger.info("NDC POST {} via {}", url, callSite);
        JsonNode response = transport.post(url, body);
        if (response == null || response.isNull()) {
            throw new RuntimeException("Empty NDC response from " + url);
        }
        return response;
    }

    private String resolveBaseUrl() {
        String base = airlineApiConfig.getBaseUrl();
        if (base == null || base.isBlank()) {
            base = "https://spair.softprobe.ai/ndc/v21.3";
        }
        return base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    }
}
