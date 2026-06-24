package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.ByteArrayEntity;
import org.apache.http.entity.ContentType;
import org.apache.http.impl.client.CloseableHttpClient;
import org.springframework.stereotype.Component;

import java.io.InputStream;

@Component
public class Apache4SyncNdcTransport implements NdcHttpTransport {

    private final CloseableHttpClient httpClient;

    public Apache4SyncNdcTransport(CloseableHttpClient apache4SyncHttpClient) {
        this.httpClient = apache4SyncHttpClient;
    }

    @Override
    public JsonNode post(String url, ObjectNode body) {
        HttpPost post = new HttpPost(url);
        post.setEntity(new ByteArrayEntity(
                NdcJsonSupport.toBytes(body), ContentType.APPLICATION_JSON));
        try (CloseableHttpResponse response = httpClient.execute(post)) {
            InputStream stream = response.getEntity() != null ? response.getEntity().getContent() : null;
            if (stream == null) {
                throw new RuntimeException("Empty NDC response from " + url);
            }
            try (InputStream in = stream) {
                return NdcJsonSupport.parseBody(url, in);
            }
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Apache HttpClient 4 sync NDC call failed: " + url, e);
        }
    }
}
