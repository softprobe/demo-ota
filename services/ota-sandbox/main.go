package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"
)

const maxDeliveries = 500

type PaymentAuthorizeRequest struct {
	BookingID     string  `json:"bookingId"`
	Amount        float64 `json:"amount"`
	Currency      string  `json:"currency"`
	PaymentMethod string  `json:"paymentMethod"`
	CardLast4     string  `json:"cardLast4,omitempty"`
}

type PaymentDelivery struct {
	AuthorizationID string  `json:"authorizationId"`
	Status          string  `json:"status"`
	BookingID       string  `json:"bookingId"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
	PaymentMethod   string  `json:"paymentMethod"`
	CardLast4       string  `json:"cardLast4,omitempty"`
	CreatedAt       string  `json:"createdAt"`
}

type PaymentAuthorizeResponse struct {
	AuthorizationID string  `json:"authorizationId"`
	Status          string  `json:"status"`
	BookingID       string  `json:"bookingId"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
}

type NotificationRequest struct {
	BookingID          string `json:"bookingId"`
	ConfirmationNumber string `json:"confirmationNumber"`
	RecipientEmail     string `json:"recipientEmail,omitempty"`
	EventType          string `json:"eventType"`
}

type NotificationDelivery struct {
	MessageID          string `json:"messageId"`
	Delivered          bool   `json:"delivered"`
	BookingID          string `json:"bookingId"`
	ConfirmationNumber string `json:"confirmationNumber"`
	RecipientEmail     string `json:"recipientEmail,omitempty"`
	EventType          string `json:"eventType"`
	CreatedAt          string `json:"createdAt"`
}

type NotificationResponse struct {
	MessageID string `json:"messageId"`
	Delivered bool   `json:"delivered"`
}

type DeliveriesSnapshot struct {
	Payments      []PaymentDelivery      `json:"payments"`
	Notifications []NotificationDelivery `json:"notifications"`
}

type DeliveryStore struct {
	mu            sync.Mutex
	cap           int
	paymentSeq    int64
	messageSeq    int64
	payments      []PaymentDelivery
	notifications []NotificationDelivery
}

func NewDeliveryStore(capacity int) *DeliveryStore {
	if capacity <= 0 {
		capacity = maxDeliveries
	}
	return &DeliveryStore{
		cap:           capacity,
		payments:      make([]PaymentDelivery, 0, capacity),
		notifications: make([]NotificationDelivery, 0, capacity),
	}
}

func (s *DeliveryStore) RecordPayment(req PaymentAuthorizeRequest) PaymentDelivery {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.paymentSeq++
	entry := PaymentDelivery{
		AuthorizationID: fmt.Sprintf("pay_auth_%d", s.paymentSeq),
		Status:          "AUTHORIZED",
		BookingID:       req.BookingID,
		Amount:          req.Amount,
		Currency:        req.Currency,
		PaymentMethod:   req.PaymentMethod,
		CardLast4:       req.CardLast4,
		CreatedAt:       time.Now().UTC().Format(time.RFC3339),
	}
	if len(s.payments) >= s.cap {
		copy(s.payments, s.payments[1:])
		s.payments[len(s.payments)-1] = entry
	} else {
		s.payments = append(s.payments, entry)
	}
	return entry
}

func (s *DeliveryStore) RecordNotification(req NotificationRequest) NotificationDelivery {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.messageSeq++
	entry := NotificationDelivery{
		MessageID:          fmt.Sprintf("msg_%d", s.messageSeq),
		Delivered:          true,
		BookingID:          req.BookingID,
		ConfirmationNumber: req.ConfirmationNumber,
		RecipientEmail:     req.RecipientEmail,
		EventType:          req.EventType,
		CreatedAt:          time.Now().UTC().Format(time.RFC3339),
	}
	if len(s.notifications) >= s.cap {
		copy(s.notifications, s.notifications[1:])
		s.notifications[len(s.notifications)-1] = entry
	} else {
		s.notifications = append(s.notifications, entry)
	}
	return entry
}

func (s *DeliveryStore) Snapshot() DeliveriesSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	payments := make([]PaymentDelivery, len(s.payments))
	copy(payments, s.payments)
	notifications := make([]NotificationDelivery, len(s.notifications))
	copy(notifications, s.notifications)
	return DeliveriesSnapshot{
		Payments:      payments,
		Notifications: notifications,
	}
}

func (s *DeliveryStore) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.payments = s.payments[:0]
	s.notifications = s.notifications[:0]
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	limited := io.LimitReader(r.Body, 64*1024)
	dec := json.NewDecoder(limited)
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return errors.New("unexpected trailing JSON input")
	}
	return nil
}

func isUpperCurrency(code string) bool {
	if len(code) != 3 {
		return false
	}
	for i := 0; i < 3; i++ {
		if code[i] < 'A' || code[i] > 'Z' {
			return false
		}
	}
	return true
}

func validatePaymentRequest(req *PaymentAuthorizeRequest) error {
	req.BookingID = strings.TrimSpace(req.BookingID)
	req.Currency = strings.TrimSpace(req.Currency)
	req.PaymentMethod = strings.TrimSpace(req.PaymentMethod)
	req.CardLast4 = strings.TrimSpace(req.CardLast4)
	if req.BookingID == "" {
		return errors.New("bookingId is required")
	}
	if math.IsNaN(req.Amount) || math.IsInf(req.Amount, 0) || req.Amount <= 0 {
		return errors.New("amount must be greater than zero")
	}
	if !isUpperCurrency(req.Currency) {
		return errors.New("currency must be a 3-letter uppercase ISO code")
	}
	if req.PaymentMethod == "" {
		return errors.New("paymentMethod is required")
	}
	if req.CardLast4 != "" && len(req.CardLast4) != 4 {
		return errors.New("cardLast4 must be 4 characters when provided")
	}
	return nil
}

func validateNotificationRequest(req *NotificationRequest) error {
	req.BookingID = strings.TrimSpace(req.BookingID)
	req.ConfirmationNumber = strings.TrimSpace(req.ConfirmationNumber)
	req.RecipientEmail = strings.TrimSpace(req.RecipientEmail)
	req.EventType = strings.TrimSpace(req.EventType)
	if req.BookingID == "" {
		return errors.New("bookingId is required")
	}
	if req.ConfirmationNumber == "" {
		return errors.New("confirmationNumber is required")
	}
	if req.EventType == "" {
		return errors.New("eventType is required")
	}
	return nil
}

func NewPaymentHandler(store *DeliveryStore) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/payments/authorize", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req PaymentAuthorizeRequest
		if err := decodeJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
			return
		}
		if err := validatePaymentRequest(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		recorded := store.RecordPayment(req)
		writeJSON(w, http.StatusOK, PaymentAuthorizeResponse{
			AuthorizationID: recorded.AuthorizationID,
			Status:          recorded.Status,
			BookingID:       recorded.BookingID,
			Amount:          recorded.Amount,
			Currency:        recorded.Currency,
		})
	})
	mux.HandleFunc("/__sandbox/deliveries", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, store.Snapshot())
		case http.MethodDelete:
			store.Clear()
			writeJSON(w, http.StatusOK, map[string]bool{"cleared": true})
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		}
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	return mux
}

func NewNotificationHandler(store *DeliveryStore) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/notifications/confirmation", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req NotificationRequest
		if err := decodeJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
			return
		}
		if err := validateNotificationRequest(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		recorded := store.RecordNotification(req)
		writeJSON(w, http.StatusOK, NotificationResponse{
			MessageID: recorded.MessageID,
			Delivered: recorded.Delivered,
		})
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	return mux
}

func envOrDefault(key, fallback string) string {
	val := strings.TrimSpace(os.Getenv(key))
	if val == "" {
		return fallback
	}
	return val
}

func main() {
	paymentAddr := envOrDefault("PAYMENT_LISTEN_ADDR", "127.0.0.1:8082")
	notificationAddr := envOrDefault("NOTIFICATION_LISTEN_ADDR", "127.0.0.1:8083")
	store := NewDeliveryStore(maxDeliveries)

	paymentSrv := &http.Server{
		Addr:              paymentAddr,
		Handler:           NewPaymentHandler(store),
		ReadHeaderTimeout: 5 * time.Second,
	}
	notificationSrv := &http.Server{
		Addr:              notificationAddr,
		Handler:           NewNotificationHandler(store),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errCh := make(chan error, 2)
	go func() {
		log.Printf("ota-sandbox payment server listening on %s", paymentAddr)
		if err := paymentSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- fmt.Errorf("payment server: %w", err)
		}
	}()
	go func() {
		log.Printf("ota-sandbox notification server listening on %s", notificationAddr)
		if err := notificationSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- fmt.Errorf("notification server: %w", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		log.Printf("ota-sandbox shutting down on %s", sig)
	case err := <-errCh:
		log.Fatalf("ota-sandbox server failed: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = paymentSrv.Shutdown(ctx)
	_ = notificationSrv.Shutdown(ctx)
}
