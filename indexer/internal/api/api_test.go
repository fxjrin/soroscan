package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/soroscan-io/soroscan/indexer/internal/icons"
	"github.com/soroscan-io/soroscan/indexer/internal/store"
)

type stubStore struct{}

func (stubStore) TransactionsByContract(context.Context, string, *store.Cursor, int, store.TransactionFilter) (store.Page, error) {
	return store.Page{}, nil
}

func (stubStore) LedgerStats(context.Context, uint32) (store.LedgerStats, error) {
	return store.LedgerStats{}, nil
}

type stubIcons struct {
	body        []byte
	contentType string
	err         error
}

func (s stubIcons) Icon(context.Context, string, string) ([]byte, string, error) {
	return s.body, s.contentType, s.err
}

func (s stubIcons) Cached() []icons.CachedIcon {
	return nil
}

func TestAssetIconRoute(t *testing.T) {
	issuer := "G" + strings.Repeat("A", 55)
	get := func(h *Handler, path string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		h.Routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		return recorder
	}

	served := get(New(stubStore{}, stubIcons{body: []byte("png"), contentType: "image/png"}),
		"/assets/AQUA/"+issuer+"/icon")
	if served.Code != http.StatusOK || served.Body.String() != "png" {
		t.Fatalf("status %d body %q", served.Code, served.Body.String())
	}
	if served.Header().Get("Content-Type") != "image/png" ||
		served.Header().Get("Cache-Control") != "public, max-age=86400" {
		t.Fatalf("unexpected headers: %v", served.Header())
	}

	missing := get(New(stubStore{}, stubIcons{err: icons.ErrNoIcon}),
		"/assets/AQUA/"+issuer+"/icon")
	if missing.Code != http.StatusNotFound ||
		missing.Header().Get("Cache-Control") != "public, max-age=3600" {
		t.Fatalf("miss: status %d headers %v", missing.Code, missing.Header())
	}

	invalid := get(New(stubStore{}, stubIcons{}), "/assets/not-a-code!/"+issuer+"/icon")
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid code: status %d", invalid.Code)
	}
}

func TestParseCursor(t *testing.T) {
	hash := strings.Repeat("ab", 32)
	tests := []struct {
		name         string
		input        string
		ledger       uint32
		continueScan bool
		ok           bool
	}{
		{"row cursor", "64193215-" + hash, 64193215, false, true},
		{"bare ledger", "64193215", 64193215, false, true},
		{"scan cursor", "scan-64193215", 64193215, true, true},
		{"scan with hash is contradictory", "scan-64193215-" + hash, 0, false, false},
		{"zero ledger", "0", 0, false, false},
		{"not a cursor", "garbage", 0, false, false},
		{"short hash", "1-abcd", 0, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cursor, continueScan, ok := parseCursor(tt.input)
			if ok != tt.ok {
				t.Fatalf("ok = %v, want %v", ok, tt.ok)
			}
			if !tt.ok {
				return
			}
			if cursor.Ledger != tt.ledger {
				t.Fatalf("ledger = %d, want %d", cursor.Ledger, tt.ledger)
			}
			if continueScan != tt.continueScan {
				t.Fatalf("continueScan = %v, want %v", continueScan, tt.continueScan)
			}
		})
	}
}
