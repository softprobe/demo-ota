package org.example.config;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;

@Configuration
public class OtaDataSourceConfig {

    private static final String DEFAULT_H2_URL =
            "jdbc:h2:mem:ota;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;DB_CLOSE_DELAY=-1";

    @Bean
    public DataSource dataSource(
            @Value("${spring.datasource.url:}") String configuredUrl,
            @Value("${spring.datasource.username:}") String configuredUsername,
            @Value("${spring.datasource.password:}") String configuredPassword) {
        String url = configuredUrl == null ? "" : configuredUrl.trim();
        HikariDataSource dataSource = new HikariDataSource();
        if (url.isEmpty()) {
            dataSource.setJdbcUrl(DEFAULT_H2_URL);
            dataSource.setDriverClassName("org.h2.Driver");
            dataSource.setUsername("sa");
            dataSource.setPassword("");
            return dataSource;
        }
        dataSource.setJdbcUrl(url);
        if (url.startsWith("jdbc:postgresql:")) {
            dataSource.setDriverClassName("org.postgresql.Driver");
            if (configuredUsername != null && !configuredUsername.isBlank()) {
                dataSource.setUsername(configuredUsername);
                dataSource.setPassword(configuredPassword);
            } else if (!url.contains("user=")) {
                dataSource.setUsername("postgres");
                dataSource.setPassword(configuredPassword);
            }
        } else if (url.startsWith("jdbc:h2:")) {
            dataSource.setDriverClassName("org.h2.Driver");
            dataSource.setUsername(
                    configuredUsername == null || configuredUsername.isBlank() ? "sa" : configuredUsername);
            dataSource.setPassword(configuredPassword == null ? "" : configuredPassword);
        } else if (configuredUsername != null && !configuredUsername.isBlank()) {
            dataSource.setUsername(configuredUsername);
            dataSource.setPassword(configuredPassword);
        }
        return dataSource;
    }
}
