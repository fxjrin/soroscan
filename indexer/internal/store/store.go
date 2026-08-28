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

// TransactionsByContract returns up to limit invocations of a contract,
// newest first. beforeLedger restricts the page to ledgers below it; pass 0
// or a negative value for the newest page. An unknown contract yields no rows.
func (s *Store) TransactionsByContract(ctx context.Context, contractStrkey string, beforeLedger int64, limit int) ([]Transaction, error) {
	raw, err := decodeStrkey(contractStrkey, strkeyVersionContract)
	if err != nil {
		return nil, fmt.Errorf("contract id %q: %w", contractStrkey, err)
	}
	var contractID int16
	err = s.pool.QueryRow(ctx, `SELECT id FROM contracts WHERE contract_id = $1`, raw[:]).Scan(&contractID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query contract: %w", err)
	}
	if beforeLedger <= 0 {
		beforeLedger = math.MaxInt64 // no cursor; every real ledger sequence is below this
	}
	rows, err := s.pool.Query(ctx,
		`SELECT ct.ledger, ct.tx_hash, ct.ledger_closed_at, f.name, ct.args, ct.fee_charged
		 FROM contract_transactions ct
		 JOIN functions f ON f.id = ct.function
		 WHERE ct.contract_id = $1 AND ct.ledger < $2::bigint
		 ORDER BY ct.ledger DESC, ct.ledger_closed_at DESC
		 LIMIT $3`,
		contractID, beforeLedger, limit)
	if err != nil {
		return nil, fmt.Errorf("query transactions: %w", err)
	}
	defer rows.Close()
	var out []Transaction
	var rawArgs [][]byte
	for rows.Next() {
		var t Transaction
		var ledger int64
		var hash, args []byte
		if err := rows.Scan(&ledger, &hash, &t.ClosedAt, &t.Function, &args, &t.FeeCharged); err != nil {
			return nil, fmt.Errorf("scan transaction: %w", err)
		}
		t.Ledger = uint32(ledger)
		copy(t.TxHash[:], hash)
		out = append(out, t)
		rawArgs = append(rawArgs, args)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read transactions: %w", err)
	}
	if err := s.expandArgs(ctx, out, rawArgs); err != nil {
		return nil, err
	}
	return out, nil
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
