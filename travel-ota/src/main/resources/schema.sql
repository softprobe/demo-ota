CREATE TABLE IF NOT EXISTS ota_orders (
    confirmation_number VARCHAR(64) PRIMARY KEY,
    passenger_last_name VARCHAR(255) NOT NULL,
    booking_json CLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS ota_payments (
    payment_id VARCHAR(64) PRIMARY KEY,
    booking_id VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL
);
