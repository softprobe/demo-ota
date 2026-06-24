package org.example.config;

import com.ning.http.client.AsyncHttpClient;
import com.ning.http.client.AsyncHttpClientConfig;
import okhttp3.OkHttpClient;
import org.apache.commons.httpclient.HttpClient;
import org.apache.commons.httpclient.params.HttpConnectionManagerParams;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.impl.nio.client.CloseableHttpAsyncClient;
import org.apache.http.impl.nio.client.HttpAsyncClients;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.concurrent.TimeUnit;

@Configuration
public class HttpClientsConfig {

    @Bean(destroyMethod = "close")
    public CloseableHttpClient apache4SyncHttpClient(AirlineApiConfig config) {
        RequestConfig requestConfig = RequestConfig.custom()
                .setConnectTimeout(config.getConnectionTimeout())
                .setSocketTimeout(config.getReadTimeout())
                .build();
        return HttpClients.custom()
                .setDefaultRequestConfig(requestConfig)
                .build();
    }

    @Bean(destroyMethod = "close")
    public CloseableHttpAsyncClient apache4AsyncHttpClient(AirlineApiConfig config) {
        RequestConfig requestConfig = RequestConfig.custom()
                .setConnectTimeout(config.getConnectionTimeout())
                .setSocketTimeout(config.getReadTimeout())
                .build();
        CloseableHttpAsyncClient client = HttpAsyncClients.custom()
                .setDefaultRequestConfig(requestConfig)
                .build();
        client.start();
        return client;
    }

    @Bean
    public HttpClient apache3HttpClient(AirlineApiConfig config) {
        HttpClient client = new HttpClient();
        HttpConnectionManagerParams params = client.getHttpConnectionManager().getParams();
        params.setConnectionTimeout(config.getConnectionTimeout());
        params.setSoTimeout(config.getReadTimeout());
        return client;
    }

    @Bean
    public OkHttpClient okHttpClient(AirlineApiConfig config) {
        return new OkHttpClient.Builder()
                .connectTimeout(config.getConnectionTimeout(), TimeUnit.MILLISECONDS)
                .readTimeout(config.getReadTimeout(), TimeUnit.MILLISECONDS)
                .writeTimeout(config.getReadTimeout(), TimeUnit.MILLISECONDS)
                .build();
    }

    @Bean(destroyMethod = "close")
    public AsyncHttpClient ningAsyncHttpClient(AirlineApiConfig config) {
        AsyncHttpClientConfig.Builder builder = new AsyncHttpClientConfig.Builder()
                .setConnectTimeout(config.getConnectionTimeout())
                .setRequestTimeout(config.getReadTimeout());
        return new AsyncHttpClient(builder.build());
    }

    @Bean
    public WebClient ndcWebClient(AirlineApiConfig config) {
        return WebClient.builder()
                .codecs(codec -> codec.defaultCodecs().maxInMemorySize(4 * 1024 * 1024))
                .build();
    }
}
