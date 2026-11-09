package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

@Component
public class WebClientNdcTransport implements NdcHttpTransport {

    private final WebClient webClient;

    public WebClientNdcTransport(WebClient ndcWebClient) {
        this.webClient = ndcWebClient;
    }

    @Override
    public JsonNode post(String url, ObjectNode body) {
        return webClient.post()
                .uri(url)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .block();
    }
}
