package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPaymentNotificationAndDeliveriesLifecycle(t *testing.T) {
	store := NewDeliveryStore(500)
	paySrv := httptest.NewServer(NewPaymentHandler(store))
	defer paySrv.Close()
	notifSrv := httptest.NewServer(NewNotificationHandler(store))
	defer notifSrv.Close()

	for _, url := range []string{paySrv.URL + "/healthz", notifSrv.URL + "/healthz"} {
		resp, err := http.Get(url)
		if err != nil {
			t.Fatalf("healthz request %s failed: %v", url, err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 from %s, got %d", url, resp.StatusCode)
		}
		var health map[string]bool
		if err := json.NewDecoder(resp.Body).Decode(&health); err != nil || !health["ok"] {
			t.Fatalf("unexpected healthz body from %s: %v (err=%v)", url, health, err)
		}
	}

	initialSnap := getDeliveries(t, paySrv.URL)
	if initialSnap.Payments == nil || len(initialSnap.Payments) != 0 {
		t.Fatalf("expected empty non-nil payments slice, got %#v", initialSnap.Payments)
	}
	if initialSnap.Notifications == nil || len(initialSnap.Notifications) != 0 {
		t.Fatalf("expected empty non-nil notifications slice, got %#v", initialSnap.Notifications)
	}

	payBody := `{"bookingId":"BK-100","amount":824.50,"currency":"USD","paymentMethod":"CREDIT_CARD","cardLast4":"1111"}`
	payResp, err := http.Post(paySrv.URL+"/v1/payments/authorize", "application/json", bytes.NewBufferString(payBody))
	if err != nil {
		t.Fatalf("authorize request failed: %v", err)
	}
	defer payResp.Body.Close()
	if payResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from authorize, got %d", payResp.StatusCode)
	}
	var auth PaymentAuthorizeResponse
	if err := json.NewDecoder(payResp.Body).Decode(&auth); err != nil {
		t.Fatalf("decode authorize response: %v", err)
	}
	if auth.AuthorizationID != "pay_auth_1" || auth.Status != "AUTHORIZED" || auth.BookingID != "BK-100" || auth.Amount != 824.50 || auth.Currency != "USD" {
		t.Fatalf("unexpected authorize response: %+v", auth)
	}

	notifBody := `{"bookingId":"BK-100","confirmationNumber":"ABC123","recipientEmail":"travel-demo@example.com","eventType":"BOOKING_CONFIRMED"}`
	notifResp, err := http.Post(notifSrv.URL+"/v1/notifications/confirmation", "application/json", bytes.NewBufferString(notifBody))
	if err != nil {
		t.Fatalf("confirmation request failed: %v", err)
	}
	defer notifResp.Body.Close()
	if notifResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from confirmation, got %d", notifResp.StatusCode)
	}
	var msg NotificationResponse
	if err := json.NewDecoder(notifResp.Body).Decode(&msg); err != nil {
		t.Fatalf("decode confirmation response: %v", err)
	}
	if msg.MessageID != "msg_1" || !msg.Delivered {
		t.Fatalf("unexpected notification response: %+v", msg)
	}

	snap := getDeliveries(t, paySrv.URL)
	if len(snap.Payments) != 1 || snap.Payments[0].AuthorizationID != "pay_auth_1" || snap.Payments[0].CardLast4 != "1111" {
		t.Fatalf("unexpected recorded payments: %+v", snap.Payments)
	}
	if len(snap.Notifications) != 1 || snap.Notifications[0].MessageID != "msg_1" || snap.Notifications[0].EventType != "BOOKING_CONFIRMED" {
		t.Fatalf("unexpected recorded notifications: %+v", snap.Notifications)
	}

	delReq, _ := http.NewRequest(http.MethodDelete, paySrv.URL+"/__sandbox/deliveries", nil)
	delResp, err := http.DefaultClient.Do(delReq)
	if err != nil {
		t.Fatalf("delete deliveries failed: %v", err)
	}
	defer delResp.Body.Close()
	if delResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from DELETE deliveries, got %d", delResp.StatusCode)
	}
	var cleared map[string]bool
	if err := json.NewDecoder(delResp.Body).Decode(&cleared); err != nil || !cleared["cleared"] {
		t.Fatalf("expected cleared=true, got %v (err=%v)", cleared, err)
	}

	afterClear := getDeliveries(t, paySrv.URL)
	if len(afterClear.Payments) != 0 || len(afterClear.Notifications) != 0 {
		t.Fatalf("expected empty slices after clear, got %+v", afterClear)
	}
}

func TestValidationAndBoundedCap(t *testing.T) {
	store := NewDeliveryStore(500)
	paySrv := httptest.NewServer(NewPaymentHandler(store))
	defer paySrv.Close()
	notifSrv := httptest.NewServer(NewNotificationHandler(store))
	defer notifSrv.Close()

	badPayments := []string{
		`{}`,
		`{"bookingId":"BK-1","amount":0,"currency":"USD","paymentMethod":"CREDIT_CARD"}`,
		`{"bookingId":"BK-1","amount":10,"currency":"usd","paymentMethod":"CREDIT_CARD"}`,
		`{"bookingId":"BK-1","amount":10,"currency":"USD","paymentMethod":""}`,
		`{"bookingId":"BK-1","amount":10,"currency":"USD","paymentMethod":"CREDIT_CARD","cardLast4":"12"}`,
	}
	for _, body := range badPayments {
		resp, err := http.Post(paySrv.URL+"/v1/payments/authorize", "application/json", bytes.NewBufferString(body))
		if err != nil {
			t.Fatalf("bad payment post failed: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for payment payload %s, got %d", body, resp.StatusCode)
		}
	}

	badNotifications := []string{
		`{}`,
		`{"bookingId":"BK-1","confirmationNumber":"","eventType":"BOOKING_CONFIRMED"}`,
		`{"bookingId":"BK-1","confirmationNumber":"ABC123","eventType":""}`,
	}
	for _, body := range badNotifications {
		resp, err := http.Post(notifSrv.URL+"/v1/notifications/confirmation", "application/json", bytes.NewBufferString(body))
		if err != nil {
			t.Fatalf("bad notification post failed: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for notification payload %s, got %d", body, resp.StatusCode)
		}
	}

	for i := 1; i <= 505; i++ {
		store.RecordPayment(PaymentAuthorizeRequest{
			BookingID:     fmt.Sprintf("BK-%d", i),
			Amount:        100,
			Currency:      "USD",
			PaymentMethod: "CREDIT_CARD",
		})
		store.RecordNotification(NotificationRequest{
			BookingID:          fmt.Sprintf("BK-%d", i),
			ConfirmationNumber: "CONF01",
			EventType:          "BOOKING_CONFIRMED",
		})
	}
	snap := store.Snapshot()
	if len(snap.Payments) != 500 || snap.Payments[0].BookingID != "BK-6" || snap.Payments[499].BookingID != "BK-505" {
		t.Fatalf("expected bounded 500 payments retaining newest entries, got len=%d first=%s last=%s",
			len(snap.Payments), snap.Payments[0].BookingID, snap.Payments[len(snap.Payments)-1].BookingID)
	}
	if len(snap.Notifications) != 500 || snap.Notifications[0].BookingID != "BK-6" || snap.Notifications[499].BookingID != "BK-505" {
		t.Fatalf("expected bounded 500 notifications retaining newest entries, got len=%d", len(snap.Notifications))
	}
}

func getDeliveries(t *testing.T, baseURL string) DeliveriesSnapshot {
	t.Helper()
	resp, err := http.Get(baseURL + "/__sandbox/deliveries")
	if err != nil {
		t.Fatalf("GET deliveries failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from GET deliveries, got %d", resp.StatusCode)
	}
	var snap DeliveriesSnapshot
	if err := json.NewDecoder(resp.Body).Decode(&snap); err != nil {
		t.Fatalf("decode deliveries: %v", err)
	}
	return snap
}
