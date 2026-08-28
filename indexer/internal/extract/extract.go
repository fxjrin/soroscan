// Package extract flattens raw ledger close meta into the records the
// indexer stores. All input is on-chain data and must never panic the
// process; values wider than int64 stay decimal strings throughout.
package extract

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"strconv"
	"time"

	"github.com/stellar/go/strkey"
	"github.com/stellar/go/xdr"
)

// Invocation is one top-level Soroban contract call.
type Invocation struct {
	ContractID string // C... strkey of the top-level invoked contract
	TxHash     [32]byte
	Ledger     uint32
	ClosedAt   time.Time
	Function   string
	ArgsJSON   []byte // canonical JSON array of decoded args; addresses stay full strkey strings here
	FeeCharged int64
}

// LedgerResult is everything the indexer keeps from one closed ledger.
type LedgerResult struct {
	Sequence    uint32
	ClosedAt    time.Time
	TxCount     int
	Invocations []Invocation
}

// Extract decodes one ledger's close meta. V0 meta predates Soroban, so
// it yields header data and transaction count with no invocations.
func Extract(meta *xdr.LedgerCloseMeta) (LedgerResult, error) {
	var header xdr.LedgerHeader
	switch meta.V {
	case 0:
		header = meta.V0.LedgerHeader.Header
	case 1:
		header = meta.V1.LedgerHeader.Header
	case 2:
		header = meta.V2.LedgerHeader.Header
	default:
		return LedgerResult{}, fmt.Errorf("unsupported ledger close meta version %d", meta.V)
	}

	result := LedgerResult{
		Sequence: uint32(header.LedgerSeq),
		ClosedAt: time.Unix(int64(header.ScpValue.CloseTime), 0).UTC(),
	}

	switch meta.V {
	case 0:
		result.TxCount = len(meta.V0.TxProcessing)
	case 1:
		result.TxCount = len(meta.V1.TxProcessing)
		for _, tx := range meta.V1.TxProcessing {
			appendInvocation(&result, tx.Result, tx.TxApplyProcessing)
		}
	case 2:
		result.TxCount = len(meta.V2.TxProcessing)
		for _, tx := range meta.V2.TxProcessing {
			appendInvocation(&result, tx.Result, tx.TxApplyProcessing)
		}
	}
	return result, nil
}

func appendInvocation(result *LedgerResult, pair xdr.TransactionResultPair, applyMeta xdr.TransactionMeta) {
	events, ok := diagnosticEvents(applyMeta)
	if !ok {
		return
	}
	for _, ev := range events {
		contractID, function, args, ok := fnCall(ev)
		if !ok {
			continue
		}
		result.Invocations = append(result.Invocations, Invocation{
			ContractID: contractID,
			TxHash:     pair.TransactionHash,
			Ledger:     result.Sequence,
			ClosedAt:   result.ClosedAt,
			Function:   function,
			ArgsJSON:   encodeArgs(args),
			FeeCharged: int64(pair.Result.FeeCharged),
		})
		return // later fn_call events are nested sub-invocations
	}
}

func diagnosticEvents(meta xdr.TransactionMeta) ([]xdr.DiagnosticEvent, bool) {
	switch meta.V {
	case 3:
		if meta.V3.SorobanMeta == nil {
			return nil, false
		}
		return meta.V3.SorobanMeta.DiagnosticEvents, true
	case 4:
		if meta.V4.SorobanMeta == nil {
			return nil, false
		}
		return meta.V4.DiagnosticEvents, true // v4 moved diagnostics off SorobanMeta
	}
	return nil, false
}

func fnCall(ev xdr.DiagnosticEvent) (contractID, function string, args xdr.ScVal, ok bool) {
	if ev.Event.Body.V != 0 {
		return "", "", xdr.ScVal{}, false
	}
	topics := ev.Event.Body.V0.Topics
	if len(topics) != 3 {
		return "", "", xdr.ScVal{}, false
	}
	label, ok := topics[0].GetSym()
	if !ok || label != "fn_call" {
		return "", "", xdr.ScVal{}, false
	}
	rawID, ok := topics[1].GetBytes()
	if !ok || len(rawID) != 32 {
		return "", "", xdr.ScVal{}, false
	}
	name, ok := topics[2].GetSym()
	if !ok {
		return "", "", xdr.ScVal{}, false
	}
	encoded, err := strkey.Encode(strkey.VersionByteContract, rawID)
	if err != nil {
		return "", "", xdr.ScVal{}, false
	}
	return encoded, string(name), ev.Event.Body.V0.Data, true
}

func encodeArgs(data xdr.ScVal) []byte {
	var buf bytes.Buffer
	if vec, ok := data.GetVec(); ok && vec != nil {
		writeVals(&buf, *vec)
		return buf.Bytes()
	}
	buf.WriteByte('[') // a single argument arrives unwrapped
	writeVal(&buf, data)
	buf.WriteByte(']')
	return buf.Bytes()
}

func writeVals(buf *bytes.Buffer, vals []xdr.ScVal) {
	buf.WriteByte('[')
	for i, v := range vals {
		if i > 0 {
			buf.WriteByte(',')
		}
		writeVal(buf, v)
	}
	buf.WriteByte(']')
}

func writeVal(buf *bytes.Buffer, val xdr.ScVal) {
	switch val.Type {
	case xdr.ScValTypeScvBool:
		buf.WriteString(strconv.FormatBool(*val.B))
	case xdr.ScValTypeScvVoid:
		buf.WriteString("null")
	case xdr.ScValTypeScvU32:
		buf.WriteString(strconv.FormatUint(uint64(*val.U32), 10))
	case xdr.ScValTypeScvI32:
		buf.WriteString(strconv.FormatInt(int64(*val.I32), 10))
	case xdr.ScValTypeScvU64:
		writeUint64(buf, uint64(*val.U64))
	case xdr.ScValTypeScvI64:
		buf.WriteString(strconv.FormatInt(int64(*val.I64), 10))
	case xdr.ScValTypeScvTimepoint:
		writeUint64(buf, uint64(*val.Timepoint))
	case xdr.ScValTypeScvDuration:
		writeUint64(buf, uint64(*val.Duration))
	case xdr.ScValTypeScvU128:
		writeString(buf, bigFromUnsigned(uint64(val.U128.Hi), uint64(val.U128.Lo)).String())
	case xdr.ScValTypeScvI128:
		writeString(buf, bigFromSigned(int64(val.I128.Hi), uint64(val.I128.Lo)).String())
	case xdr.ScValTypeScvU256:
		writeString(buf, bigFromUnsigned(uint64(val.U256.HiHi), uint64(val.U256.HiLo), uint64(val.U256.LoHi), uint64(val.U256.LoLo)).String())
	case xdr.ScValTypeScvI256:
		writeString(buf, bigFromSigned(int64(val.I256.HiHi), uint64(val.I256.HiLo), uint64(val.I256.LoHi), uint64(val.I256.LoLo)).String())
	case xdr.ScValTypeScvBytes:
		writeString(buf, hex.EncodeToString(*val.Bytes))
	case xdr.ScValTypeScvString:
		writeString(buf, string(*val.Str))
	case xdr.ScValTypeScvSymbol:
		writeString(buf, string(*val.Sym))
	case xdr.ScValTypeScvAddress:
		writeString(buf, addressString(*val.Address))
	case xdr.ScValTypeScvVec:
		if *val.Vec == nil {
			buf.WriteString("[]")
			return
		}
		writeVals(buf, **val.Vec)
	case xdr.ScValTypeScvMap:
		if *val.Map == nil {
			buf.WriteString("{}")
			return
		}
		writeMap(buf, **val.Map)
	default:
		writeString(buf, val.String()) // errors, instances, and ledger keys have no natural JSON shape
	}
}

func writeUint64(buf *bytes.Buffer, v uint64) {
	text := strconv.FormatUint(v, 10)
	if v > math.MaxInt64 {
		writeString(buf, text) // past int64 the number form would silently lose precision downstream
		return
	}
	buf.WriteString(text)
}

func writeString(buf *bytes.Buffer, s string) {
	encoded, _ := json.Marshal(s) // marshaling a string cannot fail
	buf.Write(encoded)
}

func writeMap(buf *bytes.Buffer, entries []xdr.ScMapEntry) {
	buf.WriteByte('{')
	for i, entry := range entries {
		if i > 0 {
			buf.WriteByte(',')
		}
		writeMapKey(buf, entry.Key)
		buf.WriteByte(':')
		writeVal(buf, entry.Val)
	}
	buf.WriteByte('}')
}

func writeMapKey(buf *bytes.Buffer, key xdr.ScVal) {
	var tmp bytes.Buffer
	writeVal(&tmp, key)
	raw := tmp.Bytes()
	if len(raw) > 0 && raw[0] == '"' {
		buf.Write(raw)
		return
	}
	writeString(buf, string(raw)) // non-string keys keep their JSON text form, quoted
}

func addressString(addr xdr.ScAddress) string {
	s, err := addr.String()
	if err != nil {
		return addr.Type.String() // an address family this build cannot render as strkey
	}
	return s
}

func bigFromUnsigned(parts ...uint64) *big.Int {
	result := new(big.Int)
	for _, part := range parts {
		result.Lsh(result, 64)
		result.Add(result, new(big.Int).SetUint64(part))
	}
	return result
}

func bigFromSigned(hi int64, rest ...uint64) *big.Int {
	result := big.NewInt(hi)
	for _, part := range rest {
		result.Lsh(result, 64)
		result.Add(result, new(big.Int).SetUint64(part))
	}
	return result
}
