package extract

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"math"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/stellar/go-stellar-sdk/strkey"
	"github.com/stellar/go-stellar-sdk/xdr"

	"github.com/soroscan-io/soroscan/indexer/internal/lake"
)

func boolVal(v bool) xdr.ScVal {
	return xdr.ScVal{Type: xdr.ScValTypeScvBool, B: &v}
}

func voidVal() xdr.ScVal {
	return xdr.ScVal{Type: xdr.ScValTypeScvVoid}
}

func u32Val(v uint32) xdr.ScVal {
	u := xdr.Uint32(v)
	return xdr.ScVal{Type: xdr.ScValTypeScvU32, U32: &u}
}

func u64Val(v uint64) xdr.ScVal {
	u := xdr.Uint64(v)
	return xdr.ScVal{Type: xdr.ScValTypeScvU64, U64: &u}
}

func i128Val(hi int64, lo uint64) xdr.ScVal {
	parts := xdr.Int128Parts{Hi: xdr.Int64(hi), Lo: xdr.Uint64(lo)}
	return xdr.ScVal{Type: xdr.ScValTypeScvI128, I128: &parts}
}

func u128Val(hi, lo uint64) xdr.ScVal {
	parts := xdr.UInt128Parts{Hi: xdr.Uint64(hi), Lo: xdr.Uint64(lo)}
	return xdr.ScVal{Type: xdr.ScValTypeScvU128, U128: &parts}
}

func bytesVal(v []byte) xdr.ScVal {
	b := xdr.ScBytes(v)
	return xdr.ScVal{Type: xdr.ScValTypeScvBytes, Bytes: &b}
}

func strVal(v string) xdr.ScVal {
	s := xdr.ScString(v)
	return xdr.ScVal{Type: xdr.ScValTypeScvString, Str: &s}
}

func symVal(v string) xdr.ScVal {
	s := xdr.ScSymbol(v)
	return xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: &s}
}

func vecVal(vals ...xdr.ScVal) xdr.ScVal {
	vec := xdr.ScVec(vals)
	p := &vec
	return xdr.ScVal{Type: xdr.ScValTypeScvVec, Vec: &p}
}

func mapVal(entries ...xdr.ScMapEntry) xdr.ScVal {
	m := xdr.ScMap(entries)
	p := &m
	return xdr.ScVal{Type: xdr.ScValTypeScvMap, Map: &p}
}

func accountVal(t *testing.T, address string) xdr.ScVal {
	t.Helper()
	id, err := xdr.AddressToAccountId(address)
	if err != nil {
		t.Fatalf("decode account address %s: %v", address, err)
	}
	addr := xdr.ScAddress{Type: xdr.ScAddressTypeScAddressTypeAccount, AccountId: &id}
	return xdr.ScVal{Type: xdr.ScValTypeScvAddress, Address: &addr}
}

const testAccount = "GC6ZEX4LRNXAZZ75X3II7HTMOTCE2LOXXQLG7CULAWN6RI3NTMBPINN2"

func TestEncodeArgs(t *testing.T) {
	tests := []struct {
		name string
		data xdr.ScVal
		want string
	}{
		{"vec of values", vecVal(u32Val(1), symVal("a"), strVal("b")), `[1,"a","b"]`},
		{"empty vec", vecVal(), `[]`},
		{"single value wraps", u64Val(7), `[7]`},
		{"void wraps", voidVal(), `[null]`},
		{"bool", vecVal(boolVal(true), boolVal(false)), `[true,false]`},
		{"u64 at int64 limit stays numeric", u64Val(math.MaxInt64), `[9223372036854775807]`},
		{"u64 past int64 becomes string", u64Val(math.MaxUint64), `["18446744073709551615"]`},
		{"i128 negative", i128Val(-1, 5), `["-18446744073709551611"]`},
		{"u128 small still string", u128Val(0, 42), `["42"]`},
		{"bytes lowercase hex", bytesVal([]byte{0xDE, 0xAD, 0xBE, 0xEF}), `["deadbeef"]`},
		{"address strkey", accountVal(t, testAccount), `["` + testAccount + `"]`},
		{"nested vec", vecVal(vecVal(u32Val(1), u32Val(2))), `[[1,2]]`},
		{
			"map with stringified keys",
			mapVal(
				xdr.ScMapEntry{Key: symVal("k"), Val: u32Val(1)},
				xdr.ScMapEntry{Key: u32Val(2), Val: boolVal(true)},
			),
			`[{"k":1,"2":true}]`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := encodeArgs(tt.data)
			if string(got) != tt.want {
				t.Errorf("encodeArgs = %s, want %s", got, tt.want)
			}
			if !json.Valid(got) {
				t.Errorf("encodeArgs produced invalid JSON: %s", got)
			}
		})
	}
}

func fnCallEvent(contractID [32]byte, function string, data xdr.ScVal) xdr.DiagnosticEvent {
	return xdr.DiagnosticEvent{
		InSuccessfulContractCall: true,
		Event: xdr.ContractEvent{
			Type: xdr.ContractEventTypeDiagnostic,
			Body: xdr.ContractEventBody{
				V: 0,
				V0: &xdr.ContractEventV0{
					Topics: []xdr.ScVal{symVal("fn_call"), bytesVal(contractID[:]), symVal(function)},
					Data:   data,
				},
			},
		},
	}
}

func TestExtractV1(t *testing.T) {
	var contractID [32]byte
	contractID[31] = 7
	var txHash xdr.Hash
	txHash[0] = 0xAB

	otherEvent := xdr.DiagnosticEvent{
		InSuccessfulContractCall: true,
		Event: xdr.ContractEvent{
			Type: xdr.ContractEventTypeDiagnostic,
			Body: xdr.ContractEventBody{
				V:  0,
				V0: &xdr.ContractEventV0{Topics: []xdr.ScVal{symVal("core_metrics"), symVal("read_entry")}, Data: u64Val(3)},
			},
		},
	}

	sorobanTx := xdr.TransactionResultMeta{
		Result: xdr.TransactionResultPair{
			TransactionHash: txHash,
			Result:          xdr.TransactionResult{FeeCharged: 12345},
		},
		TxApplyProcessing: xdr.TransactionMeta{
			V: 3,
			V3: &xdr.TransactionMetaV3{
				SorobanMeta: &xdr.SorobanTransactionMeta{
					DiagnosticEvents: []xdr.DiagnosticEvent{
						otherEvent, // must be passed over: not a fn_call
						fnCallEvent(contractID, "transfer", vecVal(u32Val(9))),
						fnCallEvent(contractID, "sub_call", voidVal()), // nested call; must not become a second invocation
					},
				},
			},
		},
	}
	classicTx := xdr.TransactionResultMeta{
		TxApplyProcessing: xdr.TransactionMeta{V: 2, V2: &xdr.TransactionMetaV2{}},
	}

	meta := xdr.LedgerCloseMeta{V: 1, V1: &xdr.LedgerCloseMetaV1{
		TxProcessing: []xdr.TransactionResultMeta{classicTx, sorobanTx},
	}}
	meta.V1.LedgerHeader.Header.LedgerSeq = 100
	meta.V1.LedgerHeader.Header.ScpValue.CloseTime = 1700000000

	result, err := Extract(&meta)
	if err != nil {
		t.Fatalf("Extract: %v", err)
	}
	if result.Sequence != 100 {
		t.Errorf("Sequence = %d, want 100", result.Sequence)
	}
	if want := time.Unix(1700000000, 0).UTC(); !result.ClosedAt.Equal(want) {
		t.Errorf("ClosedAt = %v, want %v", result.ClosedAt, want)
	}
	if result.TxCount != 2 {
		t.Errorf("TxCount = %d, want 2", result.TxCount)
	}
	if len(result.Invocations) != 1 {
		t.Fatalf("Invocations = %d, want 1", len(result.Invocations))
	}

	inv := result.Invocations[0]
	wantContract, err := strkey.Encode(strkey.VersionByteContract, contractID[:])
	if err != nil {
		t.Fatalf("encode contract strkey: %v", err)
	}
	if inv.ContractID != wantContract {
		t.Errorf("ContractID = %s, want %s", inv.ContractID, wantContract)
	}
	if inv.TxHash != [32]byte(txHash) {
		t.Errorf("TxHash = %x, want %x", inv.TxHash, txHash)
	}
	if inv.Ledger != 100 {
		t.Errorf("Ledger = %d, want 100", inv.Ledger)
	}
	if inv.Function != "transfer" {
		t.Errorf("Function = %s, want transfer", inv.Function)
	}
	if string(inv.ArgsJSON) != "[9]" {
		t.Errorf("ArgsJSON = %s, want [9]", inv.ArgsJSON)
	}
	if inv.FeeCharged != 12345 {
		t.Errorf("FeeCharged = %d, want 12345", inv.FeeCharged)
	}
}

func TestExtractV0(t *testing.T) {
	meta := xdr.LedgerCloseMeta{V: 0, V0: &xdr.LedgerCloseMetaV0{
		TxProcessing: make([]xdr.TransactionResultMeta, 3),
	}}
	meta.V0.LedgerHeader.Header.LedgerSeq = 42
	meta.V0.LedgerHeader.Header.ScpValue.CloseTime = 1500000000

	result, err := Extract(&meta)
	if err != nil {
		t.Fatalf("Extract: %v", err)
	}
	if result.Sequence != 42 || result.TxCount != 3 || len(result.Invocations) != 0 {
		t.Errorf("result = %+v, want sequence 42, 3 txs, no invocations", result)
	}
}

func TestGoldenLedger64146320(t *testing.T) {
	if os.Getenv("GOLDEN_LEDGER") != "1" {
		t.Skip("set GOLDEN_LEDGER=1 to fetch the golden ledger from the public archive")
	}

	const sequence = uint32(64146320)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	client := lake.NewClient(lake.DefaultBaseURL, &http.Client{Timeout: 2 * time.Minute})
	meta, err := client.FetchLedger(ctx, sequence)
	if err != nil {
		t.Fatalf("FetchLedger(%d): %v", sequence, err)
	}

	result, err := Extract(meta)
	if err != nil {
		t.Fatalf("Extract: %v", err)
	}
	if result.Sequence != sequence {
		t.Fatalf("Sequence = %d, want %d", result.Sequence, sequence)
	}

	rawHash, err := hex.DecodeString("5d1d4ed5b69092b55d485191b021ccb2904740cd3c27c8b1be89da7f7cb836bf")
	if err != nil {
		t.Fatalf("decode expected tx hash: %v", err)
	}
	var wantHash [32]byte
	copy(wantHash[:], rawHash)

	var inv *Invocation
	for i := range result.Invocations {
		if result.Invocations[i].TxHash == wantHash {
			inv = &result.Invocations[i]
			break
		}
	}
	if inv == nil {
		t.Fatalf("no invocation with tx hash %x among %d invocations", wantHash, len(result.Invocations))
	}

	if inv.Function != "harvest" {
		t.Errorf("Function = %q, want %q", inv.Function, "harvest")
	}
	if want := "CD4GFK2QTDSRDMWX375D5LU55CMY2HUNPFYIZLXASHLEUBDBIVG6SFT4"; inv.ContractID != want {
		t.Errorf("ContractID = %s, want %s", inv.ContractID, want)
	}
	if inv.FeeCharged != 35603 {
		t.Errorf("FeeCharged = %d, want 35603", inv.FeeCharged)
	}

	var compact bytes.Buffer
	if err := json.Compact(&compact, inv.ArgsJSON); err != nil {
		t.Fatalf("compact ArgsJSON %s: %v", inv.ArgsJSON, err)
	}
	want := `["GC6ZEX4LRNXAZZ75X3II7HTMOTCE2LOXXQLG7CULAWN6RI3NTMBPINN2",[179395,179396,179397,179398,179399]]`
	if compact.String() != want {
		t.Errorf("ArgsJSON = %s, want %s", compact.String(), want)
	}
}
