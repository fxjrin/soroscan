// Package store persists contract invocations in TimescaleDB and serves the
// read queries for the API. Contract ids, function names, and address strings
// inside args are dictionary-encoded to keep the hypertable rows small.
package store

import (
	"bytes"
	"context"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/soroscan-io/soroscan/indexer/migrations"
)

// InvocationRow is one contract invocation extracted from a closed ledger.
type InvocationRow struct {
	ContractID string // C... strkey
	TxHash     [32]byte
	Ledger     uint32
	ClosedAt   time.Time
	Function   string
	ArgsJSON   []byte // JSON array; full strkey address strings inside
	FeeCharged int64
}

// Transaction is one row returned by TransactionsByContract, with the
// function name and the address strings in args fully resolved.
type Transaction struct {
	Ledger     uint32
	TxHash     [32]byte
	ClosedAt   time.Time
	Function   string
	ArgsJSON   []byte
	FeeCharged int64
}

type Store struct {
	pool *pgxpool.Pool

	mu        sync.Mutex // guards the dictionary caches below
	contracts map[string]int16
	functions map[string]int16
	addresses map[string]int32
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{
		pool:      pool,
		contracts: make(map[string]int16),
		functions: make(map[string]int16),
		addresses: make(map[string]int32),
	}
}

// Migrate applies the embedded SQL migrations that have not been recorded in
// schema_migrations yet, each inside its own transaction.
func (s *Store) Migrate(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`)
	if err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}
	entries, err := migrations.FS.ReadDir(".")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	var names []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	slices.Sort(names)
	for _, name := range names {
		var applied bool
		err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)`, name).Scan(&applied)
		if err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if applied {
			continue
		}
		sqlText, err := migrations.FS.ReadFile(name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		if err := s.applyMigration(ctx, name, string(sqlText)); err != nil {
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
	}
	return nil
}

func (s *Store) applyMigration(ctx context.Context, name, sqlText string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)
	// migration files keep semicolons out of literals, so a plain split is safe
	for i, stmt := range strings.Split(sqlText, ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := tx.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("statement %d: %w", i+1, err)
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (name) VALUES ($1)`, name); err != nil {
		return fmt.Errorf("record: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// SaveLedger stores the invocations of one ledger in a single transaction and
// advances the worker checkpoint to ledgerSeq if it is ahead of the stored
// value. Replaying an already stored ledger is a no-op, so crash recovery can
// safely resume one ledger early.
func (s *Store) SaveLedger(ctx context.Context, ledgerSeq uint32, rows []InvocationRow) error {
	contractRaw := make(map[string][]byte)
	functionNames := make(map[string]struct{})
	addressSet := make(map[string]struct{})
	parsedArgs := make([]any, len(rows))
	for i, row := range rows {
		if _, ok := contractRaw[row.ContractID]; !ok {
			raw, err := decodeStrkey(row.ContractID, strkeyVersionContract)
			if err != nil {
				return fmt.Errorf("contract id %q: %w", row.ContractID, err)
			}
			contractRaw[row.ContractID] = raw[:]
		}
		functionNames[row.Function] = struct{}{}
		if len(row.ArgsJSON) == 0 {
			continue
		}
		v, err := parseArgs(row.ArgsJSON)
		if err != nil {
			return fmt.Errorf("args of tx %x: %w", row.TxHash, err)
		}
		collectAddresses(v, addressSet)
		parsedArgs[i] = v
	}

	contractIDs, missingContracts := s.snapshotContracts(contractRaw)
	functionIDs, missingFunctions := s.snapshotFunctions(functionNames)
	addressIDs, missingAddresses := s.snapshotAddresses(addressSet)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	newContracts, err := resolveContracts(ctx, tx, missingContracts)
	if err != nil {
		return fmt.Errorf("resolve contracts: %w", err)
	}
	newFunctions, err := resolveFunctions(ctx, tx, missingFunctions)
	if err != nil {
		return fmt.Errorf("resolve functions: %w", err)
	}
	newAddresses, err := resolveAddresses(ctx, tx, missingAddresses)
	if err != nil {
		return fmt.Errorf("resolve addresses: %w", err)
	}
	mergeInto(contractIDs, newContracts)
	mergeInto(functionIDs, newFunctions)
	mergeInto(addressIDs, newAddresses)

	batch := &pgx.Batch{}
	for i, row := range rows {
		var args any
		if parsedArgs[i] != nil {
			encoded, err := json.Marshal(rewriteAddresses(parsedArgs[i], addressIDs))
			if err != nil {
				return fmt.Errorf("encode args of tx %x: %w", row.TxHash, err)
			}
			args = encoded
		}
		batch.Queue(
			`INSERT INTO contract_transactions (contract_id, tx_hash, ledger, ledger_closed_at, function, args, fee_charged)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (tx_hash, ledger_closed_at) DO NOTHING`,
			contractIDs[row.ContractID], row.TxHash[:], int64(row.Ledger), row.ClosedAt, functionIDs[row.Function], args, row.FeeCharged,
		)
	}
	batch.Queue(
		`INSERT INTO checkpoints (name, last_ledger) VALUES ('worker', $1)
		 ON CONFLICT (name) DO UPDATE SET last_ledger = GREATEST(checkpoints.last_ledger, EXCLUDED.last_ledger), updated_at = now()`,
		int64(ledgerSeq),
	)
	br := tx.SendBatch(ctx, batch)
	for i := 0; i < batch.Len(); i++ {
		if _, err := br.Exec(); err != nil {
			br.Close()
			return fmt.Errorf("batch statement %d: %w", i+1, err)
		}
	}
	if err := br.Close(); err != nil {
		return fmt.Errorf("close batch: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	// cache only after commit; a rollback would leave phantom ids behind
	s.mu.Lock()
	mergeInto(s.contracts, newContracts)
	mergeInto(s.functions, newFunctions)
	mergeInto(s.addresses, newAddresses)
	s.mu.Unlock()
	return nil
}

// CheckpointLedger returns the stored ledger for name, or 0 if none exists.
func (s *Store) CheckpointLedger(ctx context.Context, name string) (int64, error) {
	var ledger int64
	err := s.pool.QueryRow(ctx, `SELECT last_ledger FROM checkpoints WHERE name = $1`, name).Scan(&ledger)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("query checkpoint %q: %w", name, err)
	}
	return ledger, nil
}

// SetCheckpoint overwrites a checkpoint unconditionally, for backfill
// bookkeeping. The worker checkpoint only moves forward, through SaveLedger.
func (s *Store) SetCheckpoint(ctx context.Context, name string, ledger int64) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO checkpoints (name, last_ledger) VALUES ($1, $2)
		 ON CONFLICT (name) DO UPDATE SET last_ledger = EXCLUDED.last_ledger, updated_at = now()`,
		name, ledger)
	if err != nil {
		return fmt.Errorf("set checkpoint %q: %w", name, err)
	}
	return nil
}

// ErrInvalidContract marks a contract address that fails strkey decoding,
// so callers can tell bad input apart from a real storage failure.
var ErrInvalidContract = errors.New("invalid contract address")

// Cursor pins a page boundary to an exact row. The ledger alone cannot be
// the boundary: one ledger can hold more rows than a whole page, and a
// ledger-only cursor would silently skip the rest of it.
type Cursor struct {
	Ledger uint32
	TxHash [32]byte
}

// TransactionFilter narrows a contract's history page.
type TransactionFilter struct {
	// Function keeps only invocations of this function; empty keeps all.
	Function string
	// From and To bound the ledger close time; a zero value leaves that
	// side open.
	From time.Time
	To   time.Time
	// ContinueScan resumes a windowed scan strictly below the cursor's
	// ledger, after an earlier page ran out of budget before filling.
	ContinueScan bool
}

// Page is one result page. A page shorter than the limit can still carry
// ContinueLedger: the scan ran out of budget, not history, and the next
// request picks up strictly below that ledger.
type Page struct {
	Transactions   []Transaction
	ContinueLedger uint32
}

const (
	// a function-filtered page first tries the streaming plan, which is
	// fast whenever the function occurs recently but must read the whole
	// history when it does not; past this deadline the windowed scan takes
	// over so one request can never run away
	fastPathTimeout = 2 * time.Second
	// windowed-scan budget per request, sized so the densest contract
	// stays around a second: each window decompresses only its own slice
	scanWindowLedgers  = 30000
	scanWindowsPerPage = 4
)

// TransactionsByContract returns up to limit invocations of a contract,
// newest first, ordered by ledger then transaction hash descending. A nil
// cursor asks for the newest page. An unknown contract yields no rows.
func (s *Store) TransactionsByContract(ctx context.Context, contractStrkey string, before *Cursor, limit int, filter TransactionFilter) (Page, error) {
	raw, err := decodeStrkey(contractStrkey, strkeyVersionContract)
	if err != nil {
		return Page{}, fmt.Errorf("%w: %q: %v", ErrInvalidContract, contractStrkey, err)
	}
	var contractID int16
	err = s.pool.QueryRow(ctx, `SELECT id FROM contracts WHERE contract_id = $1`, raw[:]).Scan(&contractID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Page{}, nil
	}
	if err != nil {
		return Page{}, fmt.Errorf("query contract: %w", err)
	}
	functionID := int16(-1)
	if filter.Function != "" {
		err = s.pool.QueryRow(ctx, `SELECT id FROM functions WHERE name = $1`, filter.Function).Scan(&functionID)
		if errors.Is(err, pgx.ErrNoRows) {
			return Page{}, nil // a name never seen on chain matches nothing
		}
		if err != nil {
			return Page{}, fmt.Errorf("query function: %w", err)
		}
	}
	if functionID < 0 {
		out, err := s.pageByLedgers(ctx, contractID, functionID, before, limit, filter)
		if err != nil {
			return Page{}, err
		}
		return Page{Transactions: out}, nil
	}
	if !filter.ContinueScan {
		fastCtx, cancel := context.WithTimeout(ctx, fastPathTimeout)
		out, err := s.pageByLedgers(fastCtx, contractID, functionID, before, limit, filter)
		cancel()
		if err == nil {
			return Page{Transactions: out}, nil
		}
		if !errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil {
			return Page{}, err
		}
	}
	return s.pageByWindows(ctx, contractID, functionID, before, limit, filter)
}

// pageByLedgers assembles a page from bounded pieces that each prune by
// ledger: the rest of the cursor's own ledger first, then whole ledgers
// below it. A single query ordered by (ledger, tx_hash) cannot stream
// from the compressed chunks, whose order covers the ledger alone.
func (s *Store) pageByLedgers(ctx context.Context, contractID, functionID int16, before *Cursor, limit int, filter TransactionFilter) ([]Transaction, error) {
	var out []Transaction
	var rawArgs [][]byte
	boundLedger := int64(math.MaxInt64) // no cursor; every real ledger is below this
	if before != nil {
		boundLedger = int64(before.Ledger)
		pred, predArgs := filterPredicates(4, functionID, filter)
		err := s.appendTransactions(ctx, &out, &rawArgs,
			`SELECT ct.ledger, ct.tx_hash, ct.ledger_closed_at, f.name, ct.args, ct.fee_charged
			 FROM contract_transactions ct
			 JOIN functions f ON f.id = ct.function
			 WHERE ct.contract_id = $1 AND ct.ledger = $2::bigint AND ct.tx_hash < $3::bytea`+pred+`
			 ORDER BY ct.tx_hash DESC
			 LIMIT `+fmt.Sprintf("$%d", 4+len(predArgs)),
			append(append([]any{contractID, boundLedger, before.TxHash[:]}, predArgs...), limit)...)
		if err != nil {
			return nil, err
		}
	}
	if remaining := limit - len(out); remaining > 0 {
		ledgers, err := s.recentLedgers(ctx, contractID, functionID, boundLedger, remaining, filter)
		if err != nil {
			return nil, err
		}
		if len(ledgers) > 0 {
			pred, predArgs := filterPredicates(3, functionID, filter)
			err := s.appendTransactions(ctx, &out, &rawArgs,
				`SELECT ct.ledger, ct.tx_hash, ct.ledger_closed_at, f.name, ct.args, ct.fee_charged
				 FROM contract_transactions ct
				 JOIN functions f ON f.id = ct.function
				 WHERE ct.contract_id = $1 AND ct.ledger = ANY($2::bigint[])`+pred+`
				 ORDER BY ct.ledger DESC, ct.tx_hash DESC`,
				append([]any{contractID, ledgers}, predArgs...)...)
			if err != nil {
				return nil, err
			}
			// the ledger set can hold more rows than the page asked for; the
			// cursor stays sound because the boundary row's ledger is in the
			// set completely, so what is cut here is found by the next page
			if len(out) > limit {
				out = out[:limit]
				rawArgs = rawArgs[:limit]
			}
		}
	}
	if err := s.expandArgs(ctx, out, rawArgs); err != nil {
		return nil, err
	}
	return out, nil
}

// pageByWindows walks fixed ledger windows downward, so a function too
// rare for the streaming plan still makes deterministic progress: every
// window decompresses only its own slice of the contract's history.
func (s *Store) pageByWindows(ctx context.Context, contractID, functionID int16, before *Cursor, limit int, filter TransactionFilter) (Page, error) {
	floor, err := s.scanFloor(ctx, contractID, filter.From)
	if err != nil {
		return Page{}, err
	}
	if floor == 0 {
		return Page{}, nil // nothing matches the time bound at all
	}
	rowBound := false
	var hi int64
	if before != nil {
		if filter.ContinueScan {
			hi = int64(before.Ledger)
		} else {
			hi = int64(before.Ledger) + 1 // the cursor's own ledger still owes rows below its hash
			rowBound = true
		}
	} else {
		// anchor on the newest matching row, not on infinity: windows above
		// the real history would burn the whole budget scanning nothing
		ceiling, err := s.scanCeiling(ctx, contractID, filter.To)
		if err != nil {
			return Page{}, err
		}
		if ceiling == 0 {
			return Page{}, nil
		}
		hi = ceiling + 1
	}
	var out []Transaction
	var rawArgs [][]byte
	for window := 0; window < scanWindowsPerPage && hi > floor && len(out) <= limit; window++ {
		lo := hi - scanWindowLedgers
		if lo < floor {
			lo = floor
		}
		pred, predArgs := filterPredicates(4, functionID, filter)
		sql := `SELECT ct.ledger, ct.tx_hash, ct.ledger_closed_at, f.name, ct.args, ct.fee_charged
			 FROM contract_transactions ct
			 JOIN functions f ON f.id = ct.function
			 WHERE ct.contract_id = $1 AND ct.ledger >= $2::bigint AND ct.ledger < $3::bigint` + pred
		args := append([]any{contractID, lo, hi}, predArgs...)
		if rowBound {
			sql += fmt.Sprintf(` AND (ct.ledger < $%d::bigint OR ct.tx_hash < $%d::bytea)`, len(args)+1, len(args)+2)
			args = append(args, int64(before.Ledger), before.TxHash[:])
			rowBound = false
		}
		sql += ` ORDER BY ct.ledger DESC, ct.tx_hash DESC LIMIT ` + fmt.Sprintf("$%d", len(args)+1)
		args = append(args, limit+1-len(out))
		if err := s.appendTransactions(ctx, &out, &rawArgs, sql, args...); err != nil {
			return Page{}, err
		}
		hi = lo
	}
	page := Page{Transactions: out}
	if len(out) <= limit && hi > floor {
		page.ContinueLedger = uint32(hi) // budget ran out before history did
	}
	if err := s.expandArgs(ctx, page.Transactions, rawArgs); err != nil {
		return Page{}, err
	}
	return page, nil
}

// scanCeiling is the newest ledger a windowed scan starts under: the last
// row of the contract, or of its time bound. Zero means nothing matches.
func (s *Store) scanCeiling(ctx context.Context, contractID int16, to time.Time) (int64, error) {
	sql := `SELECT ledger FROM contract_transactions WHERE contract_id = $1`
	args := []any{contractID}
	if !to.IsZero() {
		sql += ` AND ledger_closed_at <= $2`
		args = append(args, to)
	}
	sql += ` ORDER BY ledger DESC LIMIT 1`
	var ledger int64
	err := s.pool.QueryRow(ctx, sql, args...).Scan(&ledger)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("query scan ceiling: %w", err)
	}
	return ledger, nil
}

// scanFloor is the oldest ledger a windowed scan must reach: the first
// row of the contract, or of its time bound. Zero means nothing matches.
func (s *Store) scanFloor(ctx context.Context, contractID int16, from time.Time) (int64, error) {
	sql := `SELECT ledger FROM contract_transactions WHERE contract_id = $1`
	args := []any{contractID}
	if !from.IsZero() {
		sql += ` AND ledger_closed_at >= $2`
		args = append(args, from)
	}
	sql += ` ORDER BY ledger ASC LIMIT 1`
	var ledger int64
	err := s.pool.QueryRow(ctx, sql, args...).Scan(&ledger)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("query scan floor: %w", err)
	}
	return ledger, nil
}

// filterPredicates renders the optional function and time conditions with
// parameter numbers starting at next, for appending to a base query.
func filterPredicates(next int, functionID int16, filter TransactionFilter) (string, []any) {
	var sql strings.Builder
	var args []any
	if functionID >= 0 {
		fmt.Fprintf(&sql, " AND ct.function = $%d", next+len(args))
		args = append(args, functionID)
	}
	if !filter.From.IsZero() {
		fmt.Fprintf(&sql, " AND ct.ledger_closed_at >= $%d", next+len(args))
		args = append(args, filter.From)
	}
	if !filter.To.IsZero() {
		fmt.Fprintf(&sql, " AND ct.ledger_closed_at <= $%d", next+len(args))
		args = append(args, filter.To)
	}
	return sql.String(), args
}

// recentLedgers lists the newest distinct matching ledgers below the
// bound, at most max of them: one page needs at most one ledger per row.
func (s *Store) recentLedgers(ctx context.Context, contractID, functionID int16, below int64, max int, filter TransactionFilter) ([]int64, error) {
	pred, predArgs := filterPredicates(3, functionID, filter)
	rows, err := s.pool.Query(ctx,
		`SELECT DISTINCT ct.ledger FROM contract_transactions ct
		 WHERE ct.contract_id = $1 AND ct.ledger < $2::bigint`+pred+`
		 ORDER BY ct.ledger DESC LIMIT `+fmt.Sprintf("$%d", 3+len(predArgs)),
		append(append([]any{contractID, below}, predArgs...), max)...)
	if err != nil {
		return nil, fmt.Errorf("query ledgers: %w", err)
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var ledger int64
		if err := rows.Scan(&ledger); err != nil {
			return nil, fmt.Errorf("scan ledger: %w", err)
		}
		out = append(out, ledger)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read ledgers: %w", err)
	}
	return out, nil
}

func (s *Store) appendTransactions(ctx context.Context, out *[]Transaction, rawArgs *[][]byte, sql string, params ...any) error {
	rows, err := s.pool.Query(ctx, sql, params...)
	if err != nil {
		return fmt.Errorf("query transactions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var t Transaction
		var ledger int64
		var hash, args []byte
		if err := rows.Scan(&ledger, &hash, &t.ClosedAt, &t.Function, &args, &t.FeeCharged); err != nil {
			return fmt.Errorf("scan transaction: %w", err)
		}
		t.Ledger = uint32(ledger)
		copy(t.TxHash[:], hash)
		*out = append(*out, t)
		*rawArgs = append(*rawArgs, args)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read transactions: %w", err)
	}
	return nil
}

// expandArgs turns the stored {"$a": id} placeholders back into the full
// address strings via one lookup for the whole page.
func (s *Store) expandArgs(ctx context.Context, out []Transaction, rawArgs [][]byte) error {
	parsed := make([]any, len(out))
	idSet := make(map[int32]struct{})
	for i, raw := range rawArgs {
		if raw == nil {
			continue
		}
		v, err := parseArgs(raw)
		if err != nil {
			return fmt.Errorf("stored args of tx %x: %w", out[i].TxHash, err)
		}
		collectPlaceholderIDs(v, idSet)
		parsed[i] = v
	}
	if len(idSet) == 0 {
		for i, raw := range rawArgs {
			out[i].ArgsJSON = raw
		}
		return nil
	}
	ids := make([]int32, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	addrRows, err := s.pool.Query(ctx, `SELECT id, address FROM arg_addresses WHERE id = ANY($1::int[])`, ids)
	if err != nil {
		return fmt.Errorf("query addresses: %w", err)
	}
	defer addrRows.Close()
	addrs := make(map[int32]string, len(ids))
	for addrRows.Next() {
		var id int32
		var addr string
		if err := addrRows.Scan(&id, &addr); err != nil {
			return fmt.Errorf("scan address: %w", err)
		}
		addrs[id] = addr
	}
	if err := addrRows.Err(); err != nil {
		return fmt.Errorf("read addresses: %w", err)
	}
	for i := range out {
		if parsed[i] == nil {
			continue
		}
		encoded, err := json.Marshal(resolvePlaceholders(parsed[i], addrs))
		if err != nil {
			return fmt.Errorf("encode args of tx %x: %w", out[i].TxHash, err)
		}
		out[i].ArgsJSON = encoded
	}
	return nil
}

func (s *Store) snapshotContracts(wanted map[string][]byte) (map[string]int16, map[string][]byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	known := make(map[string]int16, len(wanted))
	missing := make(map[string][]byte)
	for key, raw := range wanted {
		if id, ok := s.contracts[key]; ok {
			known[key] = id
		} else {
			missing[key] = raw
		}
	}
	return known, missing
}

func (s *Store) snapshotFunctions(wanted map[string]struct{}) (map[string]int16, map[string]struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	known := make(map[string]int16, len(wanted))
	missing := make(map[string]struct{})
	for key := range wanted {
		if id, ok := s.functions[key]; ok {
			known[key] = id
		} else {
			missing[key] = struct{}{}
		}
	}
	return known, missing
}

func (s *Store) snapshotAddresses(wanted map[string]struct{}) (map[string]int32, map[string]struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	known := make(map[string]int32, len(wanted))
	missing := make(map[string]struct{})
	for key := range wanted {
		if id, ok := s.addresses[key]; ok {
			known[key] = id
		} else {
			missing[key] = struct{}{}
		}
	}
	return known, missing
}

func resolveContracts(ctx context.Context, tx pgx.Tx, missing map[string][]byte) (map[string]int16, error) {
	if len(missing) == 0 {
		return nil, nil
	}
	values := make([][]byte, 0, len(missing))
	strkeyByRaw := make(map[string]string, len(missing))
	for key, raw := range missing {
		values = append(values, raw)
		strkeyByRaw[string(raw)] = key
	}
	if _, err := tx.Exec(ctx, `INSERT INTO contracts (contract_id) SELECT unnest($1::bytea[]) ON CONFLICT DO NOTHING`, values); err != nil {
		return nil, fmt.Errorf("insert: %w", err)
	}
	rows, err := tx.Query(ctx, `SELECT id, contract_id FROM contracts WHERE contract_id = ANY($1::bytea[])`, values)
	if err != nil {
		return nil, fmt.Errorf("select: %w", err)
	}
	defer rows.Close()
	resolved := make(map[string]int16, len(missing))
	for rows.Next() {
		var id int16
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		resolved[strkeyByRaw[string(raw)]] = id
	}
	return resolved, rows.Err()
}

func resolveFunctions(ctx context.Context, tx pgx.Tx, missing map[string]struct{}) (map[string]int16, error) {
	if len(missing) == 0 {
		return nil, nil
	}
	values := keysOf(missing)
	if _, err := tx.Exec(ctx, `INSERT INTO functions (name) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING`, values); err != nil {
		return nil, fmt.Errorf("insert: %w", err)
	}
	rows, err := tx.Query(ctx, `SELECT id, name FROM functions WHERE name = ANY($1::text[])`, values)
	if err != nil {
		return nil, fmt.Errorf("select: %w", err)
	}
	defer rows.Close()
	resolved := make(map[string]int16, len(missing))
	for rows.Next() {
		var id int16
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		resolved[name] = id
	}
	return resolved, rows.Err()
}

func resolveAddresses(ctx context.Context, tx pgx.Tx, missing map[string]struct{}) (map[string]int32, error) {
	if len(missing) == 0 {
		return nil, nil
	}
	values := keysOf(missing)
	if _, err := tx.Exec(ctx, `INSERT INTO arg_addresses (address) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING`, values); err != nil {
		return nil, fmt.Errorf("insert: %w", err)
	}
	rows, err := tx.Query(ctx, `SELECT id, address FROM arg_addresses WHERE address = ANY($1::text[])`, values)
	if err != nil {
		return nil, fmt.Errorf("select: %w", err)
	}
	defer rows.Close()
	resolved := make(map[string]int32, len(missing))
	for rows.Next() {
		var id int32
		var addr string
		if err := rows.Scan(&id, &addr); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		resolved[addr] = id
	}
	return resolved, rows.Err()
}

func keysOf(set map[string]struct{}) []string {
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	return keys
}

func mergeInto[V int16 | int32](dst, src map[string]V) {
	for key, id := range src {
		dst[key] = id
	}
}

var addressPattern = regexp.MustCompile(`^[GC][A-Z2-7]{55}$`)

func parseArgs(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber() // u64/i128 values must not round-trip through float64
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return v, nil
}

func collectAddresses(v any, set map[string]struct{}) {
	switch val := v.(type) {
	case string:
		if addressPattern.MatchString(val) {
			set[val] = struct{}{}
		}
	case []any:
		for _, item := range val {
			collectAddresses(item, set)
		}
	case map[string]any:
		for _, item := range val {
			collectAddresses(item, set)
		}
	}
}

func rewriteAddresses(v any, ids map[string]int32) any {
	switch val := v.(type) {
	case string:
		if addressPattern.MatchString(val) {
			return map[string]any{"$a": ids[val]}
		}
		return val
	case []any:
		for i, item := range val {
			val[i] = rewriteAddresses(item, ids)
		}
		return val
	case map[string]any:
		for key, item := range val {
			val[key] = rewriteAddresses(item, ids)
		}
		return val
	default:
		return v
	}
}

func collectPlaceholderIDs(v any, ids map[int32]struct{}) {
	switch val := v.(type) {
	case []any:
		for _, item := range val {
			collectPlaceholderIDs(item, ids)
		}
	case map[string]any:
		if id, ok := placeholderID(val); ok {
			ids[id] = struct{}{}
			return
		}
		for _, item := range val {
			collectPlaceholderIDs(item, ids)
		}
	}
}

func resolvePlaceholders(v any, addrs map[int32]string) any {
	switch val := v.(type) {
	case []any:
		for i, item := range val {
			val[i] = resolvePlaceholders(item, addrs)
		}
		return val
	case map[string]any:
		if id, ok := placeholderID(val); ok {
			return addrs[id]
		}
		for key, item := range val {
			val[key] = resolvePlaceholders(item, addrs)
		}
		return val
	default:
		return v
	}
}

func placeholderID(m map[string]any) (int32, bool) {
	if len(m) != 1 {
		return 0, false
	}
	n, ok := m["$a"].(json.Number)
	if !ok {
		return 0, false
	}
	id, err := strconv.ParseInt(string(n), 10, 32)
	if err != nil {
		return 0, false
	}
	return int32(id), true
}

const (
	strkeyVersionAccount  = 6 << 3 // G
	strkeyVersionContract = 2 << 3 // C
)

var strkeyEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

func decodeStrkey(s string, version byte) ([32]byte, error) {
	var out [32]byte
	raw, err := strkeyEncoding.DecodeString(s)
	if err != nil {
		return out, fmt.Errorf("decode base32: %w", err)
	}
	if len(raw) != 35 {
		return out, fmt.Errorf("decoded length %d, want 35", len(raw))
	}
	if raw[0] != version {
		return out, fmt.Errorf("version byte 0x%02x, want 0x%02x", raw[0], version)
	}
	if crc16(raw[:33]) != uint16(raw[33])|uint16(raw[34])<<8 {
		return out, errors.New("checksum mismatch")
	}
	copy(out[:], raw[1:33])
	return out, nil
}

func crc16(data []byte) uint16 {
	var crc uint16
	for _, b := range data {
		crc ^= uint16(b) << 8
		for range 8 {
			if crc&0x8000 != 0 {
				crc = crc<<1 ^ 0x1021 // CRC16-XModem, per the strkey spec
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}
