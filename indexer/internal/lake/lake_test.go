package lake

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/klauspost/compress/zstd"
	"github.com/stellar/go/xdr"
)

func TestObjectKey(t *testing.T) {
	tests := []struct {
		name     string
		sequence uint32
		want     string
	}{
		{"first partition", 3, "FFFFFFFF--0-63999/FFFFFFFC--3.xdr.zst"},
		{"mainnet ledger", 64146320, "FC2D7BFF--64128000-64191999/FC2D346F--64146320.xdr.zst"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ObjectKey(tt.sequence); got != tt.want {
				t.Errorf("ObjectKey(%d) = %q, want %q", tt.sequence, got, tt.want)
			}
		})
	}
}

func TestFetchLedger(t *testing.T) {
	const sequence = uint32(5)
	batch := xdr.LedgerCloseMetaBatch{
		StartSequence: xdr.Uint32(sequence),
		EndSequence:   xdr.Uint32(sequence),
		LedgerCloseMetas: []xdr.LedgerCloseMeta{{
			V:  0,
			V0: &xdr.LedgerCloseMetaV0{},
		}},
	}
	batch.LedgerCloseMetas[0].V0.LedgerHeader.Header.LedgerSeq = xdr.Uint32(sequence)

	raw, err := batch.MarshalBinary()
	if err != nil {
		t.Fatalf("marshal batch: %v", err)
	}
	var compressed bytes.Buffer
	writer, err := zstd.NewWriter(&compressed)
	if err != nil {
		t.Fatalf("new zstd writer: %v", err)
	}
	if _, err := writer.Write(raw); err != nil {
		t.Fatalf("compress batch: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close zstd writer: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/"+ObjectKey(sequence) {
			http.NotFound(w, r)
			return
		}
		w.Write(compressed.Bytes())
	}))
	defer server.Close()

	client := NewClient(server.URL, server.Client())

	meta, err := client.FetchLedger(context.Background(), sequence)
	if err != nil {
		t.Fatalf("FetchLedger(%d): %v", sequence, err)
	}
	if got := uint32(meta.V0.LedgerHeader.Header.LedgerSeq); got != sequence {
		t.Errorf("ledger sequence = %d, want %d", got, sequence)
	}

	_, err = client.FetchLedger(context.Background(), sequence+1)
	if !errors.Is(err, ErrNotYetPublished) {
		t.Errorf("FetchLedger(%d) error = %v, want ErrNotYetPublished", sequence+1, err)
	}
}
