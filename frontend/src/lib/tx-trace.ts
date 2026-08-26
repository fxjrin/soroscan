import { StrKey } from "@stellar/stellar-sdk/base";
import type {
  ContractEvent,
  InvokeContractArgs,
  LedgerEntryChange,
  SorobanAuthorizedInvocation,
  Transaction,
  TransactionMetaV3Arm,
  TransactionMetaV4Arm,
} from "@stellar/stellar-sdk/xdr";
import {
  decodeScAddress,
  decodeScSymbol,
  decodeScVal,
  type ScDisplay,
} from "@/lib/scval";

/** A contract event, attached to the call that raised it when known. */
export interface TraceEvent {
  contract?: string;
  topics: Array<ScDisplay | undefined>;
  data?: ScDisplay;
  /** when this fired among its siblings; see TraceCall.seq */
  seq: number;
}

/** One node of the nested contract call tree. */
export interface TraceCall {
  contract?: string;
  fn: string;
  args: Array<ScDisplay | undefined>;
  result?: ScDisplay;
  events: TraceEvent[];
  calls: TraceCall[];
  /**
   * when this happened among its siblings. A frame's events and its
   * sub-calls are interleaved in the stream, so keeping them in two lists
   * would otherwise print a contract's events before work that came first
   */
  seq: number;
}

export interface TraceStateChange {
  kind: "created" | "updated" | "removed" | "restored";
  contract?: string;
  durability?: string;
  key?: ScDisplay;
  value?: ScDisplay;
}

export interface TraceTtl {
  keyHash: string; // hex of the ledger key hash the ttl entry points at
  liveUntilLedger: number;
  /** Resolved owner, when the hashed key appears in the same meta. */
  contract?: string;
  entry?: string; // "contract state" | "contract instance" | "contract code"
}

/** Resource fee split from the soroban meta, in stroops. */
export interface TraceFees {
  nonRefundable: string;
  refundable: string;
  rent: string;
}

export interface TxTrace {
  /**
   * "diagnostics" is the real executed tree from the RPC diagnostic
   * events; "auth" is reconstructed from the signed authorization data,
   * which only covers sub-calls that required authorization and never
   * knows return values.
   */
  source: "diagnostics" | "auth";
  calls: TraceCall[];
  /** Events that could not be attributed to a specific call. */
  events: TraceEvent[];
  stateChanges: TraceStateChange[];
  ttlExtensions: TraceTtl[];
  /** Raw core_metrics counters (u64 decimal strings) keyed by metric name. */
  metrics: Record<string, string>;
  fees?: TraceFees;
  truncated: boolean;
}

type Xdr = typeof import("@stellar/stellar-sdk/xdr");
type MetaArm = TransactionMetaV3Arm | TransactionMetaV4Arm;

const MAX_ITEMS = 500; // per list; a screenful many times over, bounds hostile meta

export function countTraceCalls(calls: TraceCall[]): number {
  let count = 0;
  for (const call of calls) {
    count += 1 + countTraceCalls(call.calls);
  }
  return count;
}

function symbolOf(display: ScDisplay | undefined): string | undefined {
  return display?.kind === "text" && display.type === "sym"
    ? display.text
    : undefined;
}

function hexOf(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

// fn_call names its callee as a 32-byte bytes topic; some hosts emit a
// full address value instead, so both shapes resolve to a strkey
function contractOf(display: ScDisplay | undefined): string | undefined {
  if (display?.kind === "address") {
    return display.address;
  }
  if (display?.kind === "text" && display.type === "bytes") {
    const hex = display.text.slice(2);
    if (/^[0-9a-f]{64}$/.test(hex)) {
      const bytes = new Uint8Array(32);
      for (let index = 0; index < 32; index++) {
        bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
      }
      return StrKey.encodeContract(bytes);
    }
  }
  return undefined;
}

function scValB64(value: unknown): string {
  return (value as { toXdr(format: "base64"): string }).toXdr("base64");
}

function contractIdOf(xdr: Xdr, id: unknown): string | undefined {
  if (id === null || id === undefined) {
    return undefined;
  }
  try {
    return decodeScAddress(
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeContract(id as never),
      ).toXdr("base64"),
    );
  } catch {
    return undefined;
  }
}

function scAddressOf(xdr: Xdr, address: unknown): string | undefined {
  try {
    return decodeScAddress(
      xdr.ScVal.scvAddress(address as never).toXdr("base64"),
    );
  } catch {
    return undefined;
  }
}

function eventOf(
  xdr: Xdr,
  raw: ContractEvent,
  seq = 0,
): TraceEvent | undefined {
  if (raw.body.type !== "v0") {
    return undefined;
  }
  const data = decodeScVal(scValB64(raw.body.v0.data));
  return {
    contract: contractIdOf(xdr, raw.contractId),
    topics: raw.body.v0.topics.map((topic) => decodeScVal(scValB64(topic))),
    data: data?.type === "void" ? undefined : data,
    seq,
  };
}

interface DiagnosticWalk {
  calls: TraceCall[];
  events: TraceEvent[];
  metrics: Record<string, string>;
  truncated: boolean;
}

// fn_call pushes a frame and fn_return pops it; a contract event lands
// on the frame that was executing when it fired
function walkDiagnostics(
  xdr: Xdr,
  stream: Array<{ event: ContractEvent }>,
): DiagnosticWalk {
  const calls: TraceCall[] = [];
  const events: TraceEvent[] = [];
  const metrics: Record<string, string> = {};
  const stack: TraceCall[] = [];
  let nodes = 0;
  let raised = 0;
  let seq = 0;
  for (const raw of stream) {
    if (raw.event.body.type !== "v0") {
      continue;
    }
    const { topics, data } = raw.event.body.v0;
    if (raw.event.type.name === "contract") {
      if (raised >= MAX_ITEMS) {
        return { calls, events, metrics, truncated: true };
      }
      raised++;
      const event = eventOf(xdr, raw.event);
      if (event !== undefined) {
        (stack[stack.length - 1]?.events ?? events).push({
          ...event,
          seq: seq++,
        });
      }
      continue;
    }
    const label = symbolOf(
      topics[0] === undefined ? undefined : decodeScVal(scValB64(topics[0])),
    );
    if (label === "core_metrics") {
      const name = symbolOf(
        topics[1] === undefined ? undefined : decodeScVal(scValB64(topics[1])),
      );
      const value = decodeScVal(scValB64(data));
      if (name !== undefined && value?.kind === "text") {
        metrics[name] = value.text;
      }
      continue;
    }
    if (label === "fn_call") {
      if (nodes >= MAX_ITEMS) {
        return { calls, events, metrics, truncated: true };
      }
      nodes++;
      const argsValue = decodeScVal(scValB64(data));
      const node: TraceCall = {
        contract: contractOf(
          topics[1] === undefined
            ? undefined
            : decodeScVal(scValB64(topics[1])),
        ),
        fn:
          (topics[2] === undefined
            ? undefined
            : decodeScSymbol(scValB64(topics[2]))) ?? "unknown",
        args:
          argsValue?.kind === "vec"
            ? argsValue.items
            : argsValue === undefined
              ? []
              : [argsValue],
        events: [],
        calls: [],
        seq: seq++,
      };
      (stack[stack.length - 1]?.calls ?? calls).push(node);
      stack.push(node);
    } else if (label === "fn_return") {
      const frame = stack.pop();
      if (frame !== undefined) {
        const value = decodeScVal(scValB64(data));
        frame.result = value?.type === "void" ? undefined : value;
      }
    }
  }
  return { calls, events, metrics, truncated: false };
}

// without diagnostics the consensus meta still lists the raised events,
// just not which call raised them
function flatEventsOf(xdr: Xdr, meta: MetaArm): TraceEvent[] {
  const raw =
    meta.type === "v3"
      ? (meta.v3.sorobanMeta?.events ?? [])
      : meta.v4.operations.flatMap((operation) => operation.events);
  return raw
    .slice(0, MAX_ITEMS)
    .map((event, index) => eventOf(xdr, event, index))
    .filter((event) => event !== undefined);
}

interface KeyCandidate {
  bytes: Uint8Array;
  contract?: string;
  entry: string;
}

interface ChangesWalk {
  stateChanges: TraceStateChange[];
  ttlExtensions: TraceTtl[];
  keyCandidates: KeyCandidate[];
}

function walkChanges(xdr: Xdr, changes: LedgerEntryChange[]): ChangesWalk {
  const stateChanges: TraceStateChange[] = [];
  const keyCandidates: KeyCandidate[] = [];
  // a ttl entry can appear as a pre-image and as a new value in the same
  // meta; the written value wins, but a pre-image alone still tells the
  // reader how long the touched entry lives
  const ttlByHash = new Map<string, { value: number; written: boolean }>();
  const push = (kind: TraceStateChange["kind"] | "state", data: unknown) => {
    const entry = data as {
      type: string;
      contractData?: {
        contract: unknown;
        key: unknown;
        durability: { name: string };
        val?: unknown;
      };
      contractCode?: { hash: unknown };
      ttl?: { keyHash: { value: Uint8Array }; liveUntilLedgerSeq: number };
    };
    if (entry.type === "ttl" && entry.ttl !== undefined) {
      if (kind === "removed") {
        return;
      }
      const hash = hexOf(entry.ttl.keyHash.value);
      const known = ttlByHash.get(hash);
      const written = kind !== "state";
      if (
        (known === undefined || !known.written) &&
        ttlByHash.size < MAX_ITEMS
      ) {
        ttlByHash.set(hash, {
          value: entry.ttl.liveUntilLedgerSeq,
          written,
        });
      }
      return;
    }
    if (entry.type === "contractData" && entry.contractData !== undefined) {
      const key = decodeScVal(scValB64(entry.contractData.key));
      const contract = scAddressOf(xdr, entry.contractData.contract);
      if (keyCandidates.length < MAX_ITEMS) {
        // a ttl entry only names its key by hash; hashing every touched
        // key lets those rows name their contract and entry
        const bytes =
          kind === "removed"
            ? (data as { toXdr(): Uint8Array }).toXdr()
            : xdr.LedgerKey.contractData(
                new xdr.LedgerKeyContractData({
                  contract: entry.contractData.contract as never,
                  key: entry.contractData.key as never,
                  durability: entry.contractData.durability as never,
                }),
              ).toXdr();
        keyCandidates.push({
          bytes,
          contract,
          entry:
            key?.kind === "opaque" && key.type === "ledger key"
              ? "contract instance"
              : "contract state",
        });
      }
      if (kind !== "state" && stateChanges.length < MAX_ITEMS) {
        stateChanges.push({
          kind,
          contract,
          durability: entry.contractData.durability.name,
          key,
          value:
            entry.contractData.val === undefined
              ? undefined
              : decodeScVal(scValB64(entry.contractData.val)),
        });
      }
      return;
    }
    if (
      entry.type === "contractCode" &&
      entry.contractCode !== undefined &&
      keyCandidates.length < MAX_ITEMS
    ) {
      const bytes =
        kind === "removed"
          ? (data as { toXdr(): Uint8Array }).toXdr()
          : xdr.LedgerKey.contractCode(
              new xdr.LedgerKeyContractCode({
                hash: entry.contractCode.hash as never,
              }),
            ).toXdr();
      keyCandidates.push({ bytes, entry: "contract code" });
    }
  };
  for (const change of changes) {
    switch (change.type) {
      case "ledgerEntryCreated":
        push("created", change.created.data);
        break;
      case "ledgerEntryUpdated":
        push("updated", change.updated.data);
        break;
      case "ledgerEntryRestored":
        push("restored", change.restored.data);
        break;
      case "ledgerEntryRemoved":
        push("removed", change.removed);
        break;
      case "ledgerEntryState":
        push("state", change.state.data);
        break;
      default:
        break;
    }
  }
  const ttlExtensions = [...ttlByHash.entries()].map(([keyHash, ttl]) => ({
    keyHash,
    liveUntilLedger: ttl.value,
  }));
  return { stateChanges, ttlExtensions, keyCandidates };
}

// names each ttl row's owner by hashing every ledger key seen in the
// same meta; a hash with no match leaves the row unresolved
async function resolveTtlOwners(
  ttlExtensions: TraceTtl[],
  keyCandidates: KeyCandidate[],
): Promise<void> {
  const subtle = globalThis.crypto?.subtle;
  if (
    subtle === undefined ||
    ttlExtensions.length === 0 ||
    keyCandidates.length === 0
  ) {
    return;
  }
  const byHash = new Map<string, KeyCandidate>();
  for (const candidate of keyCandidates) {
    try {
      const digest = await subtle.digest("SHA-256", candidate.bytes as never);
      byHash.set(hexOf(new Uint8Array(digest)), candidate);
    } catch {
      return; // an insecure context has no digest; rows stay unresolved
    }
  }
  for (const ttl of ttlExtensions) {
    const match = byHash.get(ttl.keyHash);
    if (match !== undefined) {
      ttl.contract = match.contract;
      ttl.entry = match.entry;
    }
  }
}

function changesOf(meta: MetaArm): LedgerEntryChange[] {
  const operations =
    meta.type === "v3" ? meta.v3.operations : meta.v4.operations;
  return operations.flatMap((operation) => operation.changes);
}

function callOf(xdr: Xdr, invocation: InvokeContractArgs, seq = 0): TraceCall {
  return {
    contract: decodeScAddress(
      xdr.ScVal.scvAddress(invocation.contractAddress).toXdr("base64"),
    ),
    fn:
      decodeScSymbol(
        xdr.ScVal.scvSymbol(invocation.functionName).toXdr("base64"),
      ) ?? "unknown",
    args: invocation.args.map((arg) => decodeScVal(arg.toXdr("base64"))),
    events: [],
    calls: [],
    seq,
  };
}

const MAX_AUTH_DEPTH = 8;

function fromAuthInvocation(
  xdr: Xdr,
  invocation: SorobanAuthorizedInvocation,
  depth: number,
): TraceCall | undefined {
  if (depth > MAX_AUTH_DEPTH) {
    return undefined;
  }
  const fn = invocation.function;
  const node =
    fn.type === "sorobanAuthorizedFunctionTypeContractFn"
      ? callOf(xdr, fn.contractFn, depth)
      : { fn: "create_contract", args: [], events: [], calls: [], seq: depth };
  // an authorization tree has no interleaved events, so position among
  // siblings is simply the order the entries are listed in
  node.calls = invocation.subInvocations
    .map((sub, index) => {
      const child = fromAuthInvocation(xdr, sub, depth + 1);
      return child === undefined ? undefined : { ...child, seq: index };
    })
    .filter((sub) => sub !== undefined);
  return node;
}

function innerTransaction(
  xdr: Xdr,
  envelopeXdr: string,
): Transaction | undefined {
  const envelope = xdr.TransactionEnvelope.fromXdr(envelopeXdr, "base64");
  if (envelope.type === "envelopeTypeTx") {
    return envelope.v1.tx;
  }
  if (envelope.type === "envelopeTypeTxFeeBump") {
    return envelope.feeBump.tx.innerTx.v1.tx;
  }
  return undefined; // v0 envelopes predate soroban
}

function walkEnvelope(xdr: Xdr, envelopeXdr: string): TraceCall[] {
  const tx = innerTransaction(xdr, envelopeXdr);
  if (tx === undefined) {
    return [];
  }
  const calls: TraceCall[] = [];
  for (const operation of tx.operations) {
    if (operation.body.type !== "invokeHostFunction") {
      continue;
    }
    const op = operation.body.invokeHostFunctionOp;
    if (op.hostFunction.type !== "hostFunctionTypeInvokeContract") {
      continue;
    }
    const root = callOf(xdr, op.hostFunction.invokeContract);
    for (const entry of op.auth) {
      const invocation = entry.rootInvocation;
      const authRoot =
        invocation.function.type === "sorobanAuthorizedFunctionTypeContractFn"
          ? callOf(xdr, invocation.function.contractFn)
          : undefined;
      if (authRoot?.contract === root.contract && authRoot?.fn === root.fn) {
        // the auth root repeats the host call itself; only its children
        // add information
        root.calls.push(
          ...invocation.subInvocations
            .map((sub) => fromAuthInvocation(xdr, sub, 1))
            .filter((sub) => sub !== undefined),
        );
      } else {
        const node = fromAuthInvocation(xdr, invocation, 0);
        if (node !== undefined) {
          root.calls.push(node);
        }
      }
    }
    calls.push(root);
  }
  return calls;
}

/**
 * Builds the execution trace of a transaction: the contract call tree,
 * the events each call raised, and the storage it touched. Prefers the
 * executed tree from the RPC diagnostic events in the meta; falls back
 * to the authorization tree in the envelope when diagnostics are
 * unavailable (provider has them disabled, or the transaction left the
 * retention window). Returns undefined when no source yields anything.
 */
export async function decodeTrace(
  resultMetaXdr: string | undefined,
  envelopeXdr: string | undefined,
): Promise<TxTrace | undefined> {
  const xdr = await import("@stellar/stellar-sdk/xdr");
  let calls: TraceCall[] = [];
  let events: TraceEvent[] = [];
  let stateChanges: TraceStateChange[] = [];
  let ttlExtensions: TraceTtl[] = [];
  let metrics: Record<string, string> = {};
  let fees: TraceFees | undefined;
  let truncated = false;
  let source: TxTrace["source"] = "diagnostics";
  if (resultMetaXdr !== undefined) {
    try {
      const meta = xdr.TransactionMeta.fromXdr(resultMetaXdr, "base64");
      if (
        xdr.TransactionMeta.is(meta) &&
        (meta.type === "v3" || meta.type === "v4")
      ) {
        const stream =
          meta.type === "v3"
            ? (meta.v3.sorobanMeta?.diagnosticEvents ?? [])
            : meta.v4.diagnosticEvents;
        ({ calls, events, metrics, truncated } = walkDiagnostics(xdr, stream));
        if (calls.length === 0 && events.length === 0) {
          events = flatEventsOf(xdr, meta);
        }
        let keyCandidates: KeyCandidate[];
        ({ stateChanges, ttlExtensions, keyCandidates } = walkChanges(
          xdr,
          changesOf(meta),
        ));
        await resolveTtlOwners(ttlExtensions, keyCandidates);
        const ext =
          meta.type === "v3"
            ? meta.v3.sorobanMeta?.ext
            : meta.v4.sorobanMeta?.ext;
        if (ext?.type === "v1") {
          fees = {
            nonRefundable: String(ext.v1.totalNonRefundableResourceFeeCharged),
            refundable: String(ext.v1.totalRefundableResourceFeeCharged),
            rent: String(ext.v1.rentFeeCharged),
          };
        }
      }
    } catch {
      // fall through to the envelope
    }
  }
  if (calls.length === 0 && envelopeXdr !== undefined) {
    try {
      const authCalls = walkEnvelope(xdr, envelopeXdr);
      if (authCalls.length > 0) {
        calls = authCalls;
        source = "auth";
      }
    } catch {
      // keep whatever the meta yielded
    }
  }
  if (
    calls.length === 0 &&
    events.length === 0 &&
    stateChanges.length === 0 &&
    ttlExtensions.length === 0 &&
    Object.keys(metrics).length === 0 &&
    fees === undefined
  ) {
    return undefined;
  }
  return {
    source,
    calls,
    events,
    stateChanges,
    ttlExtensions,
    metrics,
    fees,
    truncated,
  };
}
