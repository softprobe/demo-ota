package org.example.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import java.net.InetSocketAddress;
import java.net.Proxy;

@Configuration
public class RestTemplateConfig {

    @Autowired
    private AirlineApiConfig airlineApiConfig;

    @Bean
    public RestTemplate restTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(airlineApiConfig.getConnectionTimeout());
        factory.setReadTimeout(airlineApiConfig.getReadTimeout());

        // Read proxy settings from environment variables
        Proxy proxy = createProxyFromEnvironment();
        if (proxy != null) {
            factory.setProxy(proxy);
        }

        return new RestTemplate(factory);
    }

    /**
     * Create a proxy configuration from environment variables.
     * @return Proxy object, or null if not configured
     */
    private Proxy createProxyFromEnvironment() {
        // Check proxy settings from environment variables
        String httpProxy = System.getenv("HTTP_PROXY");
        String httpsProxy = System.getenv("HTTPS_PROXY");
        String httpProxyLower = System.getenv("http_proxy");
        String httpsProxyLower = System.getenv("https_proxy");

        // Prefer uppercase environment variables; fallback to lowercase
        String proxyUrl = httpProxy != null ? httpProxy :
                httpsProxy != null ? httpsProxy :
                        httpProxyLower != null ? httpProxyLower :
                                httpsProxyLower;

        // If a proxy is set, parse and return a Proxy object
        if (proxyUrl != null && !proxyUrl.isEmpty()) {
            try {
                // Parse proxy URL, for example: http://127.0.0.1:15001
                if (proxyUrl.startsWith("http://")) {
                    String proxyWithoutProtocol = proxyUrl.substring(7);
                    String[] parts = proxyWithoutProtocol.split(":");
                    if (parts.length == 2) {
                        String proxyHost = parts[0];
                        int proxyPort = Integer.parseInt(parts[1]);
                        return new Proxy(Proxy.Type.HTTP, new InetSocketAddress(proxyHost, proxyPort));
                    }
                }
            } catch (Exception e) {
                // If parsing fails, log the error and proceed without a proxy
                System.err.println("Failed to parse proxy URL: " + proxyUrl + ", error: " + e.getMessage());
            }
        }

        // If not configured or parsing fails, return null
        return null;
    }
}
