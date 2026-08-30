package store

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDecodeStrkey(t *testing.T) {
	// SEP-23 test vector payload
	sep23 := "3f0c34bf93ad0d9971d04ccc90f705511c838aad9734a4a2fb0d7a03fc7fe89a"
	tests := []struct {
		name    string
		input   string
		version byte
		want    string
		wantErr bool
	}{
		{"account", "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ", strkeyVersionAccount, sep23, false},
		{"contract", "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA", strkeyVersionContract, sep23, false},
		{"wrong version", "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ", strkeyVersionContract, "", true},
		{"bad checksum", "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDB", strkeyVersionContract, "", true},
		{"bad length", "CA7QYNF7", strkeyVersionContract, "", true},
		{"bad alphabet", "ca7qynf7sowq3glr2bgmzehxavirza4kvwltjjfc7mgxua74p7ujuwda", strkeyVersionContract, "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := decodeStrkey(tt.input, tt.version)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if hex.EncodeToString(got[:]) != tt.want {
				t.Fatalf("payload %x, want %s", got, tt.want)
			}
		})
	}
}

func TestSaveLedgerIdempotent(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	st := New(pool)
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// start clean so the test can run repeatedly against the same database
	_, err = pool.Exec(ctx, `TRUNCATE contract_transactions, contracts, functions, arg_addresses, checkpoints RESTART IDENTITY`)
	if err != nil {
		t.Fatalf("truncate: %v", err)
	}

	contract := testStrkey(t, strkeyVersionContract, 0x01)
	accountArg := testStrkey(t, strkeyVersionAccount, 0x02)
	contractArg := testStrkey(t, strkeyVersionContract, 0x03)
	closedAt := time.Now().UTC().Truncate(time.Microsecond) // timestamptz keeps microseconds
	argsJSON := []byte(`["` + accountArg + `",{"to":"` + contractArg + `","amount":"340282366920938463463374607431768211455"},7]`)
	rows := []InvocationRow{
		{
			ContractID: contract,
			TxHash:     fillHash(0xAA),
			Ledger:     100,
			ClosedAt:   closedAt,
			Function:   "transfer",
			ArgsJSON:   argsJSON,
			FeeCharged: 100123,
		},
		{
			ContractID: contract,
			TxHash:     fillHash(0xBB),
			Ledger:     100,
			ClosedAt:   closedAt.Add(5 * time.Second),
			Function:   "mint",
			ArgsJSON:   nil,
			FeeCharged: 250,
		},
	}

	if err := st.SaveLedger(ctx, 100, rows); err != nil {
		t.Fatalf("first save: %v", err)
	}
	// a fresh Store proves idempotency at the database, not through warm caches
	if err := New(pool).SaveLedger(ctx, 100, rows); err != nil {
		t.Fatalf("second save: %v", err)
	}

	var txCount, addrCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM contract_transactions`).Scan(&txCount); err != nil {
		t.Fatal(err)
	}
	if txCount != 2 {
		t.Fatalf("contract_transactions count %d, want 2", txCount)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM arg_addresses`).Scan(&addrCount); err != nil {
		t.Fatal(err)
	}
	if addrCount != 2 {
		t.Fatalf("arg_addresses count %d, want 2", addrCount)
	}
	checkpoint, err := st.CheckpointLedger(ctx, "worker")
	if err != nil {
		t.Fatal(err)
	}
	if checkpoint != 100 {
		t.Fatalf("checkpoint %d, want 100", checkpoint)
	}

	page, err := st.TransactionsByContract(ctx, contract, nil, 10, TransactionFilter{})
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	txs := page.Transactions
	if len(txs) != 2 {
		t.Fatalf("got %d transactions, want 2", len(txs))
	}
	newest, oldest := txs[0], txs[1]
	if newest.TxHash != fillHash(0xBB) || oldest.TxHash != fillHash(0xAA) {
		t.Fatalf("wrong order: %x then %x", newest.TxHash, oldest.TxHash)
	}
	if newest.Function != "mint" || newest.ArgsJSON != nil || newest.FeeCharged != 250 {
		t.Fatalf("unexpected newest row: %+v", newest)
	}
	if !newest.ClosedAt.Equal(rows[1].ClosedAt) {
		t.Fatalf("newest closed at %v, want %v", newest.ClosedAt, rows[1].ClosedAt)
	}
	if oldest.Function != "transfer" || oldest.Ledger != 100 || oldest.FeeCharged != 100123 {
		t.Fatalf("unexpected oldest row: %+v", oldest)
	}
	var got, want any
	if err := json.Unmarshal(oldest.ArgsJSON, &got); err != nil {
		t.Fatalf("returned args %s: %v", oldest.ArgsJSON, err)
	}
	if err := json.Unmarshal(argsJSON, &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("args round trip:\ngot  %s\nwant %s", oldest.ArgsJSON, argsJSON)
	}
}

func TestTransactionsByContractPagesThroughDenseLedger(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	st := New(pool)
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	_, err = pool.Exec(ctx, `TRUNCATE contract_transactions, contracts, functions, arg_addresses, checkpoints RESTART IDENTITY`)
	if err != nil {
		t.Fatalf("truncate: %v", err)
	}

	contract := testStrkey(t, strkeyVersionContract, 0x01)
	closedAt := time.Now().UTC().Truncate(time.Microsecond)
	row := func(hash byte, ledger uint32) InvocationRow {
		return InvocationRow{
			ContractID: contract,
			TxHash:     fillHash(hash),
			Ledger:     ledger,
			ClosedAt:   closedAt,
			Function:   "work",
			FeeCharged: 1,
		}
	}
	// ledger 100 holds more rows than one page, the exact shape a
	// ledger-only cursor used to lose rows on
	if err := st.SaveLedger(ctx, 200, []InvocationRow{
		row(0x99, 100), row(0xAA, 100), row(0xBB, 100), row(0xCC, 200),
	}); err != nil {
		t.Fatalf("save: %v", err)
	}

	firstPage, err := st.TransactionsByContract(ctx, contract, nil, 2, TransactionFilter{})
	if err != nil {
		t.Fatalf("first page: %v", err)
	}
	first := firstPage.Transactions
	if len(first) != 2 || first[0].TxHash != fillHash(0xCC) || first[1].TxHash != fillHash(0xBB) {
		t.Fatalf("unexpected first page: %+v", first)
	}

	cursor := &Cursor{Ledger: first[1].Ledger, TxHash: first[1].TxHash}
	secondPage, err := st.TransactionsByContract(ctx, contract, cursor, 2, TransactionFilter{})
	if err != nil {
		t.Fatalf("second page: %v", err)
	}
	second := secondPage.Transactions
	if len(second) != 2 || second[0].TxHash != fillHash(0xAA) || second[1].TxHash != fillHash(0x99) {
		t.Fatalf("rows of the split ledger went missing: %+v", second)
	}

	cursor = &Cursor{Ledger: second[1].Ledger, TxHash: second[1].TxHash}
	thirdPage, err := st.TransactionsByContract(ctx, contract, cursor, 2, TransactionFilter{})
	if err != nil {
		t.Fatalf("third page: %v", err)
	}
	if len(thirdPage.Transactions) != 0 {
		t.Fatalf("expected exhausted history, got %+v", thirdPage.Transactions)
	}
}

func TestTransactionsByContractFilters(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	st := New(pool)
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	_, err = pool.Exec(ctx, `TRUNCATE contract_transactions, contracts, functions, arg_addresses, checkpoints RESTART IDENTITY`)
	if err != nil {
		t.Fatalf("truncate: %v", err)
	}

	contract := testStrkey(t, strkeyVersionContract, 0x01)
	early := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	late := time.Date(2026, 5, 10, 0, 0, 0, 0, time.UTC)
	rows := []InvocationRow{
		{ContractID: contract, TxHash: fillHash(0xAA), Ledger: 100, ClosedAt: early, Function: "plant", FeeCharged: 1},
		{ContractID: contract, TxHash: fillHash(0xBB), Ledger: 100, ClosedAt: early, Function: "work", FeeCharged: 1},
		{ContractID: contract, TxHash: fillHash(0xCC), Ledger: 900, ClosedAt: late, Function: "work", FeeCharged: 1},
	}
	if err := st.SaveLedger(ctx, 900, rows); err != nil {
		t.Fatalf("save: %v", err)
	}

	byFunction, err := st.TransactionsByContract(ctx, contract, nil, 10, TransactionFilter{Function: "work"})
	if err != nil {
		t.Fatalf("function filter: %v", err)
	}
	if len(byFunction.Transactions) != 2 ||
		byFunction.Transactions[0].TxHash != fillHash(0xCC) ||
		byFunction.Transactions[1].TxHash != fillHash(0xBB) {
		t.Fatalf("unexpected function page: %+v", byFunction.Transactions)
	}

	unknown, err := st.TransactionsByContract(ctx, contract, nil, 10, TransactionFilter{Function: "nope"})
	if err != nil || len(unknown.Transactions) != 0 {
		t.Fatalf("unknown function should match nothing: %+v %v", unknown.Transactions, err)
	}

	byTime, err := st.TransactionsByContract(ctx, contract, nil, 10, TransactionFilter{To: early.Add(time.Hour)})
	if err != nil {
		t.Fatalf("time filter: %v", err)
	}
	if len(byTime.Transactions) != 2 || byTime.Transactions[0].Ledger != 100 {
		t.Fatalf("unexpected time page: %+v", byTime.Transactions)
	}

	// the windowed path must find the same rows the streaming path does,
	// and report an exhausted scan rather than a continue cursor
	scanned, err := st.TransactionsByContract(ctx, contract, &Cursor{Ledger: 901},
		10, TransactionFilter{Function: "work", ContinueScan: true})
	if err != nil {
		t.Fatalf("windowed scan: %v", err)
	}
	if len(scanned.Transactions) != 2 || scanned.ContinueLedger != 0 {
		t.Fatalf("unexpected windowed page: %+v continue %d", scanned.Transactions, scanned.ContinueLedger)
	}
}

func TestLedgerStats(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	st := New(pool)
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	_, err = pool.Exec(ctx, `TRUNCATE contract_transactions, contracts, functions, arg_addresses, checkpoints RESTART IDENTITY`)
	if err != nil {
		t.Fatalf("truncate: %v", err)
	}

	contractA := testStrkey(t, strkeyVersionContract, 0x01)
	contractB := testStrkey(t, strkeyVersionContract, 0x02)
	closedAt := time.Now().UTC().Truncate(time.Microsecond)
	rows := []InvocationRow{
		{ContractID: contractA, TxHash: fillHash(0xAA), Ledger: 500, ClosedAt: closedAt, Function: "work", FeeCharged: 1},
		{ContractID: contractA, TxHash: fillHash(0xBB), Ledger: 500, ClosedAt: closedAt, Function: "plant", FeeCharged: 1},
		{ContractID: contractB, TxHash: fillHash(0xCC), Ledger: 500, ClosedAt: closedAt, Function: "work", FeeCharged: 1},
	}
	if err := st.SaveLedger(ctx, 500, rows); err != nil {
		t.Fatalf("save: %v", err)
	}

	stats, err := st.LedgerStats(ctx, 500)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.Invocations != 3 || stats.Contracts != 2 || stats.Functions != 2 || !stats.Indexed {
		t.Fatalf("unexpected stats: %+v", stats)
	}

	// a quiet ledger the worker has passed reads as indexed silence, and a
	// ledger past the checkpoint reads as not indexed rather than empty
	quiet, err := st.LedgerStats(ctx, 400)
	if err != nil || quiet.Invocations != 0 || !quiet.Indexed {
		t.Fatalf("unexpected quiet stats: %+v %v", quiet, err)
	}
	ahead, err := st.LedgerStats(ctx, 501)
	if err != nil || ahead.Indexed {
		t.Fatalf("unexpected ahead stats: %+v %v", ahead, err)
	}
}

func fillHash(b byte) [32]byte {
	var h [32]byte
	for i := range h {
		h[i] = b
	}
	return h
}

func testStrkey(t *testing.T, version byte, payload byte) string {
	t.Helper()
	raw := make([]byte, 35)
	raw[0] = version
	for i := 1; i < 33; i++ {
		raw[i] = payload
	}
	crc := crc16(raw[:33])
	raw[33] = byte(crc)
	raw[34] = byte(crc >> 8)
	return strkeyEncoding.EncodeToString(raw)
}
