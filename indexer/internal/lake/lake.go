// Package lake reads ledger close meta from the public S3 ledger archive,
// which publishes pubnet ledgers in the SEP-54 object layout.
package lake

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/klauspost/compress/zstd"
	"github.com/stellar/go-stellar-sdk/xdr"
)

// DefaultBaseURL is the AWS public blockchain mirror of pubnet ledgers.
const DefaultBaseURL = "https://aws-public-blockchain.s3.amazonaws.com/v1.1/stellar/ledgers/pubnet"

// ErrNotYetPublished reports that the archive has no object for the
// requested sequence, which is normal near the tip while uploads lag
// ledger close.
var ErrNotYetPublished = errors.New("ledger not yet published to the archive")

const partitionSize = 64000

// Client fetches individual ledgers from a SEP-54 archive over HTTP.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient targets the archive at baseURL, using httpClient for
// transport policy such as timeouts. A nil httpClient falls back to
// http.DefaultClient.
func NewClient(baseURL string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{
		baseURL:    strings.TrimSuffix(baseURL, "/"),
		httpClient: httpClient,
	}
}

// ObjectKey returns the archive object path for a ledger sequence.
// Partitions span 64000 ledgers, and names are prefixed with the bitwise
// complement of the sequence in hex so that lexicographic S3 listings
// order newest ledgers first.
func ObjectKey(sequence uint32) string {
	start := sequence / partitionSize * partitionSize
	end := start + partitionSize - 1
	return fmt.Sprintf("%08X--%d-%d/%08X--%d.xdr.zst", ^start, start, end, ^sequence, sequence)
}

// FetchLedger downloads and decodes the close meta for one ledger.
// It returns an error wrapping ErrNotYetPublished when the archive does
// not hold the sequence yet.
func (c *Client) FetchLedger(ctx context.Context, sequence uint32) (*xdr.LedgerCloseMeta, error) {
	url := c.baseURL + "/" + ObjectKey(sequence)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request for ledger %d: %w", sequence, err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch ledger %d: %w", sequence, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("fetch ledger %d: %w", sequence, ErrNotYetPublished)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch ledger %d: unexpected status %s", sequence, resp.Status)
	}

	reader, err := zstd.NewReader(resp.Body, zstd.WithDecoderConcurrency(1)) // one small object per call; worker goroutines buy nothing
	if err != nil {
		return nil, fmt.Errorf("open zstd stream for ledger %d: %w", sequence, err)
	}
	defer reader.Close()

	raw, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("decompress ledger %d: %w", sequence, err)
	}

	var batch xdr.LedgerCloseMetaBatch
	if err := batch.UnmarshalBinary(raw); err != nil {
		return nil, fmt.Errorf("decode ledger %d batch: %w", sequence, err)
	}
	if len(batch.LedgerCloseMetas) == 0 {
		return nil, fmt.Errorf("ledger %d: batch holds no close meta", sequence)
	}
	return &batch.LedgerCloseMetas[0], nil
}
