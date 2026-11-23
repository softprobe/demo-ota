CREATE TABLE IF NOT EXISTS ota_orders (
    booking_id VARCHAR(128) PRIMARY KEY,
    confirmation_number VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    payment_status VARCHAR(32) NOT NULL,
    flight_id VARCHAR(128),
    fare_id VARCHAR(128),
    flight_number VARCHAR(64),
    departure_airport VARCHAR(16),
    arrival_airport VARCHAR(16),
    departure_time VARCHAR(64),
    arrival_time VARCHAR(64),
    cabin_class VARCHAR(32),
    passenger_first_name VARCHAR(64),
    passenger_last_name VARCHAR(64),
    contact_email VARCHAR(255),
    amount NUMERIC(12, 2),
    currency VARCHAR(16),
    payload_json TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ota_orders_route ON ota_orders (departure_airport, arrival_airport);
CREATE INDEX IF NOT EXISTS idx_ota_orders_confirmation ON ota_orders (confirmation_number);

CREATE TABLE IF NOT EXISTS ota_payments (
    payment_id VARCHAR(128) PRIMARY KEY,
    booking_id VARCHAR(128) NOT NULL,
    authorization_id VARCHAR(128),
    transaction_id VARCHAR(128),
    status VARCHAR(32) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(16) NOT NULL,
    payment_method VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ota_payments_booking ON ota_payments (booking_id);

CREATE TABLE IF NOT EXISTS ota_booking_sessions (
    session_id VARCHAR(128) PRIMARY KEY,
    offers_json TEXT NOT NULL,
    pending_json TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
