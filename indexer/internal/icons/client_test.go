package icons

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestIsPublicIP(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "::1", "10.0.0.5", "172.16.9.9", "192.168.1.1",
		"169.254.169.254", "0.0.0.0", "fe80::1", "fc00::1", "224.0.0.1",
	}
	for _, addr := range blocked {
		if isPublicIP(net.ParseIP(addr)) {
			t.Errorf("%s should be blocked", addr)
		}
	}
	allowed := []string{"1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:2800:220:1::1"}
	for _, addr := range allowed {
		if !isPublicIP(net.ParseIP(addr)) {
			t.Errorf("%s should be allowed", addr)
		}
	}
}

func TestGuardedClientRefusesLoopback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) },
	))
	t.Cleanup(server.Close)

	client := GuardedClient(2 * time.Second)
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := client.Do(request); err == nil {
		t.Fatal("the guard should refuse to dial a loopback server")
	}
}
