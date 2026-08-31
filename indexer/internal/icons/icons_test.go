package icons

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

const (
	issuer   = "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA"
	pngBytes = "png-bytes"
)

func TestCurrencyImage(t *testing.T) {
	toml := `
VERSION = "2.0.0"

[[CURRENCIES]]
code = "OTHER"
issuer = "` + issuer + `"
image = "https://a.example/other.png"

[[ CURRENCIES ]]
code='AQUA'
issuer = '` + issuer + `'
image="https://a.example/aqua.png"

[DOCUMENTATION]
image = "https://a.example/not-a-currency.png"
`
	if got := currencyImage(toml, "AQUA", issuer); got != "https://a.example/aqua.png" {
		t.Fatalf("image = %q", got)
	}
	if got := currencyImage(toml, "AQUA", "GAAA"); got != "" {
		t.Fatalf("wrong issuer matched: %q", got)
	}
	if got := currencyImage(toml, "MISSING", issuer); got != "" {
		t.Fatalf("missing code matched: %q", got)
	}
}

// one tls server plays horizon, toml host, and image host, so every url
// in the chain is https and the production-only rules run unmodified
func testService(t *testing.T, homeDomain, imageType string, withEntry bool) (*Service, *atomic.Int64) {
	t.Helper()
	var tomlHits atomic.Int64
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	t.Cleanup(server.Close)

	mux.HandleFunc("/accounts/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"home_domain": %q}`, homeDomain)
	})
	mux.HandleFunc("/toml", func(w http.ResponseWriter, r *http.Request) {
		tomlHits.Add(1)
		if withEntry {
			fmt.Fprintf(w, "[[CURRENCIES]]\ncode = \"AQUA\"\nissuer = %q\nimage = %q\n",
				issuer, server.URL+"/icon.png")
		}
	})
	mux.HandleFunc("/icon.png", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", imageType)
		fmt.Fprint(w, pngBytes)
	})

	service := New(server.Client(), server.URL)
	service.tomlURL = server.URL + "/toml#%s" // the domain rides in a fragment the server ignores
	return service, &tomlHits
}

func TestIconResolvesAndCaches(t *testing.T) {
	service, tomlHits := testService(t, "aqua.network", "image/png", true)

	body, contentType, err := service.Icon(context.Background(), "AQUA", issuer)
	if err != nil {
		t.Fatalf("icon: %v", err)
	}
	if string(body) != pngBytes || contentType != "image/png" {
		t.Fatalf("got %q %q", body, contentType)
	}

	if _, _, err := service.Icon(context.Background(), "AQUA", issuer); err != nil {
		t.Fatalf("cached icon: %v", err)
	}
	if tomlHits.Load() != 1 {
		t.Fatalf("toml fetched %d times, want 1", tomlHits.Load())
	}
}

func TestIconMissesAreCachedToo(t *testing.T) {
	service, tomlHits := testService(t, "aqua.network", "image/png", false)

	for range 2 {
		_, _, err := service.Icon(context.Background(), "AQUA", issuer)
		if !errors.Is(err, ErrNoIcon) {
			t.Fatalf("expected ErrNoIcon, got %v", err)
		}
	}
	if tomlHits.Load() != 1 {
		t.Fatalf("toml fetched %d times, want 1", tomlHits.Load())
	}
}

func TestIconRefusesNonImageContent(t *testing.T) {
	service, _ := testService(t, "aqua.network", "text/html", true)

	_, _, err := service.Icon(context.Background(), "AQUA", issuer)
	if !errors.Is(err, ErrNoIcon) {
		t.Fatalf("expected ErrNoIcon for text/html, got %v", err)
	}
}

func TestIconWithoutHomeDomain(t *testing.T) {
	service, _ := testService(t, "", "image/png", true)

	_, _, err := service.Icon(context.Background(), "AQUA", issuer)
	if !errors.Is(err, ErrNoIcon) {
		t.Fatalf("expected ErrNoIcon without home_domain, got %v", err)
	}
}
