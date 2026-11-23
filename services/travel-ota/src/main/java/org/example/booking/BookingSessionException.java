package org.example.booking;

public class BookingSessionException extends RuntimeException {
    private final int status;

    public BookingSessionException(int status, String message) {
        super(message);
        this.status = status;
    }

    public BookingSessionException(int status, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
    }

    public int getStatus() {
        return status;
    }
}
