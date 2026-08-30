package api

import (
	"strings"
	"testing"
)

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
