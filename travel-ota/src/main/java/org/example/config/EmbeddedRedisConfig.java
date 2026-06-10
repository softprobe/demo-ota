package org.example.config;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import redis.embedded.RedisServer;

import java.io.IOException;

/**
 * 进程内 embedded redis-server —— 让 travel-ota 自包含,不依赖任何集群级 Redis。
 *
 * 为什么内嵌够用:单副本部署下缓存不要求持久化,数据随进程生命周期即可;
 * 客户端仍走标准 Lettuce 连 localhost:6379,后续要切外部 Redis 只需改连接配置,
 * 业务代码零改动。
 *
 * base image eclipse-temurin:21-jre-jammy 是 glibc,embedded-redis 内置的
 * redis-server 二进制兼容。
 */
@Configuration
public class EmbeddedRedisConfig {

    @Value("${spring.data.redis.port:6379}")
    private int port;

    private RedisServer redisServer;

    @PostConstruct
    public void start() throws IOException {
        redisServer = new RedisServer(port);
        redisServer.start();
    }

    @PreDestroy
    public void stop() throws IOException {
        if (redisServer != null) {
            redisServer.stop();
        }
    }
}
