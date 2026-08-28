package api

import (
	"context"
	"encoding/hex"
	"encoding/json"
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
	// extra rows fetched past the limit so a page can end on a whole
	// ledger; a cursor is a ledger number, and cutting a ledger in half
	// would silently drop its remaining transactions from the next page
	boundaryLookahead = 20
)

var contractPattern = regexp.MustCompile(`^C[A-Z2-7]{55}$`)

type reader interface {
	TransactionsByContract(ctx context.Context, contractStrkey string, beforeLedger int64, limit int) ([]store.Transaction, error)
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

type transactionOut struct {
	TxHash     string          `json:"tx_hash"`
	Ledger     uint32          `json:"ledger"`
	ClosedAt   time.Time       `json:"closed_at"`
	Function   string          `json:"function"`
	Args       json.RawMessage `json:"args"`
	FeeCharged int64           `json:"fee_charged"`
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
	var cursor int64
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 1 {
			writeError(w, http.StatusBadRequest, "cursor must be a ledger sequence")
			return
		}
		cursor = parsed
	}

	rows, err := h.store.TransactionsByContract(r.Context(), contractID, cursor, limit+boundaryLookahead)
	if err != nil {
		log.Printf("transactions %s: %v", contractID, err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	rows, more := trimToLedgerBoundary(rows, limit)

	out := struct {
		Transactions []transactionOut `json:"transactions"`
		NextCursor   *int64           `json:"next_cursor,omitempty"`
	}{Transactions: make([]transactionOut, len(rows))}
	for i, row := range rows {
		out.Transactions[i] = transactionOut{
			TxHash:     hex.EncodeToString(row.TxHash[:]),
			Ledger:     row.Ledger,
			ClosedAt:   row.ClosedAt,
			Function:   row.Function,
			Args:       argsOrNull(row.ArgsJSON),
			FeeCharged: row.FeeCharged,
		}
	}
	if more && len(rows) > 0 {
		next := int64(rows[len(rows)-1].Ledger)
		out.NextCursor = &next
	}
	writeJSON(w, out)
}

// keeps whole ledgers together: the page ends at the last ledger that
// fits inside the limit, unless a single ledger alone overflows it, in
// which case every fetched row of that ledger is returned instead
func trimToLedgerBoundary(rows []store.Transaction, limit int) ([]store.Transaction, bool) {
	if len(rows) <= limit {
		return rows, false
	}
	cut := limit
	boundary := rows[limit].Ledger
	for cut > 0 && rows[cut-1].Ledger == boundary {
		cut--
	}
	if cut == 0 {
		for cut = limit; cut < len(rows) && rows[cut].Ledger == boundary; cut++ {
		}
	}
	return rows[:cut], true
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
