package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.apache.http.HttpResponse;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.concurrent.FutureCallback;
import org.apache.http.entity.ByteArrayEntity;
import org.apache.http.entity.ContentType;
import org.apache.http.impl.nio.client.CloseableHttpAsyncClient;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.util.concurrent.CompletableFuture;

@Component
public class Apache4AsyncNdcTransport implements NdcHttpTransport {

    private final CloseableHttpAsyncClient httpClient;

    public Apache4AsyncNdcTransport(CloseableHttpAsyncClient apache4AsyncHttpClient) {
        this.httpClient = apache4AsyncHttpClient;
    }

    @Override
    public JsonNode post(String url, ObjectNode body) {
        HttpPost post = new HttpPost(url);
        post.setEntity(new ByteArrayEntity(
                NdcJsonSupport.toBytes(body), ContentType.APPLICATION_JSON));
        CompletableFuture<JsonNode> future = new CompletableFuture<>();
        httpClient.execute(post, new FutureCallback<HttpResponse>() {
            @Override
            public void completed(HttpResponse response) {
                try {
                    if (response.getEntity() == null) {
                        future.completeExceptionally(
                                new RuntimeException("Empty NDC response from " + url));
                        return;
                    }
                    try (InputStream in = response.getEntity().getContent()) {
                        future.complete(NdcJsonSupport.parseBody(url, in));
                    }
                } catch (Exception e) {
                    future.completeExceptionally(e);
                }
            }

            @Override
            public void failed(Exception ex) {
                future.completeExceptionally(
                        new RuntimeException("Apache HttpClient 4 async NDC call failed: " + url, ex));
            }

            @Override
            public void cancelled() {
                future.completeExceptionally(
                        new RuntimeException("Apache HttpClient 4 async NDC call cancelled: " + url));
            }
        });
        try {
            return future.get();
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Apache HttpClient 4 async NDC call failed: " + url, e);
        }
    }
}
