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

        // 从环境变量中读取代理配置
        Proxy proxy = createProxyFromEnvironment();
        if (proxy != null) {
            factory.setProxy(proxy);
        }

        return new RestTemplate(factory);
    }

    /**
     * 从环境变量中创建代理配置
     * @return Proxy对象，如果未配置则返回null
     */
    private Proxy createProxyFromEnvironment() {
        // 检查环境变量中的代理设置
        String httpProxy = System.getenv("HTTP_PROXY");
        String httpsProxy = System.getenv("HTTPS_PROXY");
        String httpProxyLower = System.getenv("http_proxy");
        String httpsProxyLower = System.getenv("https_proxy");

        // 优先使用大写的环境变量，如果没有则使用小写的
        String proxyUrl = httpProxy != null ? httpProxy :
                httpsProxy != null ? httpsProxy :
                        httpProxyLower != null ? httpProxyLower :
                                httpsProxyLower;

        // 如果有代理设置，则解析并返回Proxy对象
        if (proxyUrl != null && !proxyUrl.isEmpty()) {
            try {
                // 解析代理URL，例如: http://127.0.0.1:15001
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
                // 如果解析代理URL失败，记录错误但不使用代理
                System.err.println("Failed to parse proxy URL: " + proxyUrl + ", error: " + e.getMessage());
            }
        }

        // 如果没有配置环境变量或解析失败，返回null
        return null;
    }
}
