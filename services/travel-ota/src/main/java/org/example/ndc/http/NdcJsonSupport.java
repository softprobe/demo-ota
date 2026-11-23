package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

final class NdcJsonSupport {

    static final ObjectMapper MAPPER = new ObjectMapper();

    private NdcJsonSupport() {
    }

    static JsonNode parseBody(String url, InputStream stream) {
        try {
            JsonNode node = MAPPER.readTree(stream);
            if (node == null || node.isNull()) {
                throw new RuntimeException("Empty NDC response from " + url);
            }
            return node;
        } catch (IOException e) {
            throw new RuntimeException("Failed to parse NDC response from " + url, e);
        }
    }

    static byte[] toBytes(Object body) {
        try {
            return MAPPER.writeValueAsBytes(body);
        } catch (IOException e) {
            throw new RuntimeException("Failed to serialize NDC request body", e);
        }
    }

    static String readUtf8(InputStream stream) throws IOException {
        return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
    }
}
