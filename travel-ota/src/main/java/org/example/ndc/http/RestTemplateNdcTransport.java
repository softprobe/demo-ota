package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

@Component
public class RestTemplateNdcTransport implements NdcHttpTransport {

    private final RestTemplate restTemplate;

    public RestTemplateNdcTransport(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    @Override
    public JsonNode post(String url, ObjectNode body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<JsonNode> response = restTemplate.exchange(
                url, HttpMethod.POST, new HttpEntity<>(body, headers), JsonNode.class);
        return response.getBody();
    }
}
