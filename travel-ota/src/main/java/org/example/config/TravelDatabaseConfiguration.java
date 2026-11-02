package org.example.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;

@Configuration(proxyBeanMethods = false)
@Profile("obi-replay")
public class TravelDatabaseConfiguration {
    @Bean
    HikariDataSource ordersDataSource(
            @Value("${demo.database.orders-url}") String url,
            @Value("${demo.database.orders-username}") String username,
            @Value("${demo.database.orders-password}") String password) {
        return dataSource("travel-orders", url, username, password);
    }

    @Bean
    HikariDataSource paymentsDataSource(
            @Value("${demo.database.payments-url}") String url,
            @Value("${demo.database.payments-username}") String username,
            @Value("${demo.database.payments-password}") String password) {
        return dataSource("travel-payments", url, username, password);
    }

    @Bean
    JdbcTemplate ordersJdbcTemplate(@Qualifier("ordersDataSource") DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    @Bean
    JdbcTemplate paymentsJdbcTemplate(@Qualifier("paymentsDataSource") DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    private static HikariDataSource dataSource(String poolName, String url, String username, String password) {
        HikariConfig config = new HikariConfig();
        config.setPoolName(poolName);
        config.setJdbcUrl(url);
        config.setUsername(username);
        config.setPassword(password);
        config.setMaximumPoolSize(4);
        config.setMinimumIdle(0);
        config.setConnectionTimeout(10_000);
        return new HikariDataSource(config);
    }
}
