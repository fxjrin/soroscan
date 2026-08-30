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
// row; a bare ledger number is the old form and means "below this ledger"
var cursorPattern = regexp.MustCompile(`^([0-9]{1,10})(?:-([0-9a-f]{64}))?$`)

type reader interface {
	TransactionsByContract(ctx context.Context, contractStrkey string, before *store.Cursor, limit int) ([]store.Transaction, error)
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
	var cursor *store.Cursor
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		parsed, ok := parseCursor(raw)
		if !ok {
			writeError(w, http.StatusBadRequest, "malformed cursor")
			return
		}
		cursor = parsed
	}

	// one extra row answers whether another page exists without a second query
	rows, err := h.store.TransactionsByContract(r.Context(), contractID, cursor, limit+1)
	if errors.Is(err, store.ErrInvalidContract) {
		writeError(w, http.StatusBadRequest, "invalid contract address")
		return
	}
	if err != nil {
		log.Printf("transactions %s: %v", contractID, err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
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
	}
	writeJSON(w, out)
}

func parseCursor(raw string) (*store.Cursor, bool) {
	match := cursorPattern.FindStringSubmatch(raw)
	if match == nil {
		return nil, false
	}
	ledger, err := strconv.ParseUint(match[1], 10, 32)
	if err != nil || ledger == 0 {
		return nil, false
	}
	cursor := &store.Cursor{Ledger: uint32(ledger)}
	if match[2] == "" {
		return cursor, true // bare ledger: the zero hash sorts below every row of it
	}
	decoded, err := hex.DecodeString(match[2])
	if err != nil {
		return nil, false
	}
	copy(cursor.TxHash[:], decoded)
	return cursor, true
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
