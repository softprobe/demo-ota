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
 * 为什么内嵌够用:GCP 上 demo 是单副本 pod、每晚重置,不需要持久化、不需要多实例
 * 共享状态;内嵌 redis 的内存数据随 pod 生命周期,正好。SP agent 拦的是 Lettuce
 * 客户端调用(连 localhost:6379),录出来的 Redis span 与连外部 Redis 完全一样,
 * 所以内嵌不影响"演示 SP 录制 Redis 下游"这个目的。
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
