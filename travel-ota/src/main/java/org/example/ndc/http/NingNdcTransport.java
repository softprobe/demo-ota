package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ning.http.client.AsyncHttpClient;
import com.ning.http.client.Response;
import org.springframework.stereotype.Component;

import java.io.InputStream;

@Component
public class NingNdcTransport implements NdcHttpTransport {

    private final AsyncHttpClient asyncHttpClient;

    public NingNdcTransport(AsyncHttpClient ningAsyncHttpClient) {
        this.asyncHttpClient = ningAsyncHttpClient;
    }

    @Override
    public JsonNode post(String url, ObjectNode body) {
        try {
            Response response = asyncHttpClient.preparePost(url)
                    .setHeader("User-Agent", "travel-ota/1.0 (Softprobe demo)")
                    .setHeader("Content-Type", "application/json")
                    .setBody(NdcJsonSupport.MAPPER.writeValueAsString(body))
                    .execute()
                    .get();
            InputStream stream = response.getResponseBodyAsStream();
            if (stream == null) {
                throw new RuntimeException("Empty NDC response from " + url);
            }
            try (InputStream in = stream) {
                return NdcJsonSupport.parseBody(url, in);
            }
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Ning async-http-client NDC call failed: " + url, e);
        }
    }
}
