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

func TestCurrencyMeta(t *testing.T) {
	toml := `
VERSION = "2.0.0"

[[CURRENCIES]]
code = "OTHER"
issuer = "` + issuer + `"
image = "https://a.example/other.png"

[[ CURRENCIES ]]
code='AQUA'
issuer = '` + issuer + `'
name = "Aquarius"
desc = 'the aqua token'
image="https://a.example/aqua.png"

[DOCUMENTATION]
image = "https://a.example/not-a-currency.png"
`
	got := currencyMeta(toml, "AQUA", issuer)
	want := tomlEntry{name: "Aquarius", desc: "the aqua token", image: "https://a.example/aqua.png"}
	if got != want {
		t.Fatalf("entry = %+v, want %+v", got, want)
	}
	if got := currencyMeta(toml, "AQUA", "GAAA"); got != (tomlEntry{}) {
		t.Fatalf("wrong issuer matched: %+v", got)
	}
	if got := currencyMeta(toml, "MISSING", issuer); got != (tomlEntry{}) {
		t.Fatalf("missing code matched: %+v", got)
	}
}

func TestCleanStripsControlAndCaps(t *testing.T) {
	if got := clean("a\x00b\tc\r", 10); got != "abc" {
		t.Fatalf("clean = %q", got)
	}
	if got := clean("abcdef", 3); got != "abc" {
		t.Fatalf("capped = %q", got)
	}
	if got := clean("  padded  ", 10); got != "padded" {
		t.Fatalf("trimmed = %q", got)
	}
	// a right-to-left override and a C1 control must not survive into json
	if got := clean("Good\u202eNo\u0085", 40); got != "GoodNo" {
		t.Fatalf("direction spoof survived: %q", got)
	}
	if got := clean("a\u200bb\ufeffc", 40); got != "abc" {
		t.Fatalf("zero-width survived: %q", got)
	}
}

func TestCurrencyMetaPrefersTheEntryWithAnImage(t *testing.T) {
	toml := `
[[CURRENCIES]]
code = "AQUA"
issuer = "` + issuer + `"

[[CURRENCIES]]
code = "AQUA"
issuer = "` + issuer + `"
name = "Aquarius"
image = "https://a.example/aqua.png"
`
	got := currencyMeta(toml, "AQUA", issuer)
	if got.image != "https://a.example/aqua.png" || got.name != "Aquarius" {
		t.Fatalf("a later complete entry should win: %+v", got)
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
			fmt.Fprintf(w, "[[CURRENCIES]]\ncode = \"AQUA\"\nissuer = %q\nname = \"Aquarius\"\ndesc = \"the aqua token\"\nimage = %q\n",
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

func TestMetaSharesTheIconResolution(t *testing.T) {
	service, tomlHits := testService(t, "aqua.network", "image/png", true)

	if _, _, err := service.Icon(context.Background(), "AQUA", issuer); err != nil {
		t.Fatalf("icon: %v", err)
	}
	meta, err := service.Meta(context.Background(), "AQUA", issuer)
	if err != nil {
		t.Fatalf("meta: %v", err)
	}
	want := Meta{Name: "Aquarius", Description: "the aqua token", Domain: "aqua.network", Icon: true}
	if meta != want {
		t.Fatalf("meta = %+v, want %+v", meta, want)
	}
	if tomlHits.Load() != 1 {
		t.Fatalf("toml fetched %d times, want 1", tomlHits.Load())
	}
}

func TestMetaWithoutTomlEntryStillNamesTheDomain(t *testing.T) {
	service, _ := testService(t, "aqua.network", "image/png", false)

	meta, err := service.Meta(context.Background(), "AQUA", issuer)
	if err != nil {
		t.Fatalf("meta: %v", err)
	}
	if meta != (Meta{Domain: "aqua.network"}) {
		t.Fatalf("meta = %+v", meta)
	}
	if _, _, err := service.Icon(context.Background(), "AQUA", issuer); !errors.Is(err, ErrNoIcon) {
		t.Fatalf("expected ErrNoIcon, got %v", err)
	}
}

func TestMetaWithoutHomeDomain(t *testing.T) {
	service, _ := testService(t, "", "image/png", true)

	if _, err := service.Meta(context.Background(), "AQUA", issuer); !errors.Is(err, ErrNoMeta) {
		t.Fatalf("expected ErrNoMeta, got %v", err)
	}
}

func TestHorizonRateLimitIsTransientNotCached(t *testing.T) {
	var accountHits atomic.Int64
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	t.Cleanup(server.Close)
	mux.HandleFunc("/accounts/", func(w http.ResponseWriter, _ *http.Request) {
		accountHits.Add(1)
		w.WriteHeader(http.StatusTooManyRequests)
	})
	service := New(server.Client(), server.URL)
	service.tomlURL = server.URL + "/toml#%s"

	_, err := service.Meta(context.Background(), "AQUA", issuer)
	if err == nil || errors.Is(err, ErrNoMeta) {
		t.Fatalf("a rate limit must not read as no-meta, got %v", err)
	}
	// nothing was cached, so the next request tries horizon again
	_, _ = service.Meta(context.Background(), "AQUA", issuer)
	if accountHits.Load() != 2 {
		t.Fatalf("horizon hit %d times, want 2", accountHits.Load())
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

func TestIconDomainOverrideSkipsHorizon(t *testing.T) {
	service, _ := testService(t, "unused.example", "image/png", true)
	domainOverrides["AQUA:"+issuer] = "aqua.network"
	defer delete(domainOverrides, "AQUA:"+issuer)
	service.horizonURL = "https://horizon.invalid" // any account call would fail loudly

	body, _, err := service.Icon(context.Background(), "AQUA", issuer)
	if err != nil {
		t.Fatalf("overridden icon: %v", err)
	}
	if string(body) != pngBytes {
		t.Fatalf("body %q", body)
	}
}

func TestIconWithoutHomeDomain(t *testing.T) {
	service, _ := testService(t, "", "image/png", true)

	_, _, err := service.Icon(context.Background(), "AQUA", issuer)
	if !errors.Is(err, ErrNoIcon) {
		t.Fatalf("expected ErrNoIcon without home_domain, got %v", err)
	}
}

func TestCachedListsOutcomes(t *testing.T) {
	service, _ := testService(t, "aqua.network", "image/png", true)
	if _, _, err := service.Icon(context.Background(), "AQUA", issuer); err != nil {
		t.Fatalf("icon: %v", err)
	}
	if _, _, err := service.Icon(context.Background(), "NOPE", issuer); !errors.Is(err, ErrNoIcon) {
		t.Fatalf("expected miss, got %v", err)
	}

	cached := service.Cached()
	if len(cached) != 2 {
		t.Fatalf("cached %d entries, want 2", len(cached))
	}
	if cached[0].Code != "NOPE" || cached[0].Found || cached[0].Bytes != 0 {
		t.Fatalf("unexpected newest entry: %+v", cached[0])
	}
	if cached[1].Code != "AQUA" || !cached[1].Found || cached[1].Bytes == 0 ||
		cached[1].Name != "Aquarius" || cached[1].Domain != "aqua.network" {
		t.Fatalf("unexpected oldest entry: %+v", cached[1])
	}
}
