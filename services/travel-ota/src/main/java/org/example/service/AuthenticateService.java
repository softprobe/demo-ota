package org.example.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class AuthenticateService {
    private static final Logger logger = LoggerFactory.getLogger(AuthenticateService.class);

    public boolean authenticate(String username, String password) {
        logger.info("Running real AuthenticateService.authenticate for user: {}", username);
        // Real authentication logic
        return "admin".equals(username) && "secret123".equals(password);
    }
}
