package api

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/soroscan-io/soroscan/indexer/internal/store"
)

const (
	defaultLimit = 20
	maxLimit     = 50
)

var contractPattern = regexp.MustCompile(`^C[A-Z2-7]{55}$`)

// a cursor names the last row of the previous page: its ledger, and its
// transaction hash so a ledger larger than a page still paginates row by
// row. A bare ledger number is the old form and means "below this ledger";
// the scan- prefix resumes a windowed search that ran out of budget
var cursorPattern = regexp.MustCompile(`^(scan-)?([0-9]{1,10})(?:-([0-9a-f]{64}))?$`)

var functionPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)

type reader interface {
	TransactionsByContract(ctx context.Context, contractStrkey string, before *store.Cursor, limit int, filter store.TransactionFilter) (store.Page, error)
	LedgerStats(ctx context.Context, sequence uint32) (store.LedgerStats, error)
}

type Handler struct {
	store reader
}

func New(st reader) *Handler {
	return &Handler{store: st}
}

func (h *Handler) Routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /contracts/{id}/transactions", h.contractTransactions)
	mux.HandleFunc("GET /ledgers/{sequence}/soroban", h.ledgerSoroban)
	return mux
}

// FeeCharged is a string: stroop amounts are 64-bit and json numbers
// lose precision past 2^53 in every javascript consumer
type transactionOut struct {
	TxHash     string          `json:"tx_hash"`
	Ledger     uint32          `json:"ledger"`
	ClosedAt   time.Time       `json:"closed_at"`
	Function   string          `json:"function"`
	Args       json.RawMessage `json:"args"`
	FeeCharged string          `json:"fee_charged"`
}

func (h *Handler) contractTransactions(w http.ResponseWriter, r *http.Request) {
	contractID := r.PathValue("id")
	if !contractPattern.MatchString(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract address")
		return
	}
	limit := defaultLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > maxLimit {
			writeError(w, http.StatusBadRequest, "limit must be between 1 and 50")
			return
		}
		limit = parsed
	}
	var filter store.TransactionFilter
	if raw := r.URL.Query().Get("function"); raw != "" {
		if !functionPattern.MatchString(raw) {
			writeError(w, http.StatusBadRequest, "malformed function name")
			return
		}
		filter.Function = raw
	}
	for name, dst := range map[string]*time.Time{"from": &filter.From, "to": &filter.To} {
		raw := r.URL.Query().Get(name)
		if raw == "" {
			continue
		}
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, name+" must be an RFC 3339 timestamp")
			return
		}
		*dst = parsed
	}
	if !filter.From.IsZero() && !filter.To.IsZero() && filter.To.Before(filter.From) {
		writeError(w, http.StatusBadRequest, "to must not be before from")
		return
	}
	var cursor *store.Cursor
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		parsed, continueScan, ok := parseCursor(raw)
		if !ok {
			writeError(w, http.StatusBadRequest, "malformed cursor")
			return
		}
		if continueScan && filter.Function == "" {
			writeError(w, http.StatusBadRequest, "malformed cursor")
			return
		}
		cursor = parsed
		filter.ContinueScan = continueScan
	}

	// one extra row answers whether another page exists without a second query
	page, err := h.store.TransactionsByContract(r.Context(), contractID, cursor, limit+1, filter)
	if errors.Is(err, store.ErrInvalidContract) {
		writeError(w, http.StatusBadRequest, "invalid contract address")
		return
	}
	if err != nil {
		log.Printf("transactions %s: %v", contractID, err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	rows := page.Transactions
	more := len(rows) > limit
	if more {
		rows = rows[:limit]
	}

	out := struct {
		Transactions []transactionOut `json:"transactions"`
		NextCursor   *string          `json:"next_cursor,omitempty"`
	}{Transactions: make([]transactionOut, len(rows))}
	for i, row := range rows {
		out.Transactions[i] = transactionOut{
			TxHash:     hex.EncodeToString(row.TxHash[:]),
			Ledger:     row.Ledger,
			ClosedAt:   row.ClosedAt,
			Function:   row.Function,
			Args:       argsOrNull(row.ArgsJSON),
			FeeCharged: strconv.FormatInt(row.FeeCharged, 10),
		}
	}
	if more && len(rows) > 0 {
		last := rows[len(rows)-1]
		next := fmt.Sprintf("%d-%s", last.Ledger, hex.EncodeToString(last.TxHash[:]))
		out.NextCursor = &next
	} else if page.ContinueLedger > 0 {
		next := fmt.Sprintf("scan-%d", page.ContinueLedger)
		out.NextCursor = &next
	}
	writeJSON(w, out)
}

func (h *Handler) ledgerSoroban(w http.ResponseWriter, r *http.Request) {
	sequence, err := strconv.ParseUint(r.PathValue("sequence"), 10, 32)
	if err != nil || sequence == 0 {
		writeError(w, http.StatusBadRequest, "invalid ledger sequence")
		return
	}
	stats, err := h.store.LedgerStats(r.Context(), uint32(sequence))
	if err != nil {
		log.Printf("ledger soroban %d: %v", sequence, err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, struct {
		Invocations int64 `json:"invocations"`
		Contracts   int64 `json:"contracts"`
		Functions   int64 `json:"functions"`
		Indexed     bool  `json:"indexed"`
	}{stats.Invocations, stats.Contracts, stats.Functions, stats.Indexed})
}

func parseCursor(raw string) (*store.Cursor, bool, bool) {
	match := cursorPattern.FindStringSubmatch(raw)
	if match == nil {
		return nil, false, false
	}
	continueScan := match[1] != ""
	if continueScan && match[3] != "" {
		return nil, false, false // a scan cursor is a bare ledger by construction
	}
	ledger, err := strconv.ParseUint(match[2], 10, 32)
	if err != nil || ledger == 0 {
		return nil, false, false
	}
	cursor := &store.Cursor{Ledger: uint32(ledger)}
	if match[3] == "" {
		return cursor, continueScan, true // bare ledger: the zero hash sorts below every row of it
	}
	decoded, err := hex.DecodeString(match[3])
	if err != nil {
		return nil, false, false
	}
	copy(cursor.TxHash[:], decoded)
	return cursor, false, true
}

func argsOrNull(raw []byte) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage("null")
	}
	return json.RawMessage(raw)
}

func writeJSON(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]string{"error": message}); err != nil {
		log.Printf("encode error response: %v", err)
	}
}
