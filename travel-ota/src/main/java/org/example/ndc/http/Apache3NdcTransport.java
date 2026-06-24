package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.apache.commons.httpclient.HttpClient;
import org.apache.commons.httpclient.methods.PostMethod;
import org.apache.commons.httpclient.methods.StringRequestEntity;
import org.springframework.stereotype.Component;

@Component
public class Apache3NdcTransport implements NdcHttpTransport {

    private final HttpClient httpClient;

    public Apache3NdcTransport(HttpClient apache3HttpClient) {
        this.httpClient = apache3HttpClient;
    }

    @Override
    public JsonNode post(String url, ObjectNode body) {
        PostMethod post = new PostMethod(url);
        try {
            post.setRequestHeader("User-Agent", "travel-ota/1.0 (Softprobe demo)");
            post.setRequestHeader("Accept", "application/json");
            post.setRequestEntity(new StringRequestEntity(
                    NdcJsonSupport.MAPPER.writeValueAsString(body),
                    "application/json",
                    "UTF-8"));
            int status = httpClient.executeMethod(post);
            String bodyText = post.getResponseBodyAsString();
            if (bodyText == null || bodyText.isBlank()) {
                throw new RuntimeException("Empty NDC response from " + url + " (HTTP " + status + ")");
            }
            return NdcJsonSupport.MAPPER.readTree(bodyText);
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Apache HttpClient 3 NDC call failed: " + url, e);
        } finally {
            post.releaseConnection();
        }
    }
}
