import { fetchJsonWithFailover, UpstreamError } from "@/lib/failover";
import { NETWORKS, type NetworkId } from "@/lib/network";

interface JsonRpcResponse<T> {
  id?: number | string;
  result?: T;
  error?: unknown;
}

export interface RpcHealth {
  status: string;
  latestLedger: number;
  latestLedgerCloseTime: number | string; // string on some providers per the wire
  oldestLedger: number;
  oldestLedgerCloseTime: number | string;
  ledgerRetentionWindow: number;
}

let nextRequestId = 1;

function errorMessage(error: unknown) {
  if (error !== null && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}

export async function rpcCall<T>(
  network: NetworkId,
  method: string,
  params?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const requestId = nextRequestId++;
  const { status, ok, body } = await fetchJsonWithFailover<JsonRpcResponse<T>>(
    NETWORKS[network].rpcUrls,
    "",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
    },
    signal,
  );
  if (!ok) {
    throw new UpstreamError(`rpc ${status} for ${method}`, status);
  }
  if (body.error !== undefined) {
    throw new UpstreamError(`${method}: ${errorMessage(body.error)}`);
  }
  if (!("result" in body)) {
    throw new UpstreamError(`${method}: response has no result`);
  }
  if (body.id !== undefined && String(body.id) !== String(requestId)) {
    throw new UpstreamError(`${method}: response id mismatch`);
  }
  return body.result as T;
}

export interface RpcTransaction {
  status: "SUCCESS" | "FAILED" | "NOT_FOUND";
  resultMetaXdr?: string;
}

/**
 * NOT_FOUND is a valid answer, not a provider failure: it also covers
 * transactions older than the provider's retention window. The caller
 * must validate the hash shape before sending it.
 */
export async function fetchRpcTransaction(
  network: NetworkId,
  hash: string,
  signal?: AbortSignal,
): Promise<RpcTransaction> {
  const tx = await rpcCall<RpcTransaction>(
    network,
    "getTransaction",
    { hash },
    signal,
  );
  if (typeof tx?.status !== "string") {
    throw new UpstreamError("getTransaction: malformed response body");
  }
  return tx;
}

interface FeePercentiles {
  max: string;
  min: string;
  p50: string;
  p90: string;
  p99: string;
}

export interface RpcFeeStats {
  sorobanInclusionFee: FeePercentiles;
  inclusionFee: FeePercentiles;
  latestLedger: number;
}

export async function fetchFeeStats(
  network: NetworkId,
  signal?: AbortSignal,
): Promise<RpcFeeStats> {
  const stats = await rpcCall<RpcFeeStats>(
    network,
    "getFeeStats",
    undefined,
    signal,
  );
  if (typeof stats?.inclusionFee?.p50 !== "string") {
    throw new UpstreamError("getFeeStats: malformed response body");
  }
  return stats;
}

export async function fetchHealth(
  network: NetworkId,
  signal?: AbortSignal,
): Promise<RpcHealth> {
  const health = await rpcCall<RpcHealth>(
    network,
    "getHealth",
    undefined,
    signal,
  );
  if (
    typeof health?.latestLedger !== "number" ||
    typeof health?.status !== "string"
  ) {
    throw new UpstreamError("getHealth: malformed response body");
  }
  return health;
}

export interface RpcLedgerEntry {
  dataXdr: string;
  lastModifiedLedgerSeq: number;
  liveUntilLedgerSeq?: number;
}

/**
 * A ledger key with no live entry is a valid answer, not a provider
 * failure: the caller learns this from an empty `entries` array, never
 * an error. Reads the current, tip-of-chain ledger state, so a caller
 * should not cache the answer as if it were immutable.
 */
export async function fetchLedgerEntries(
  network: NetworkId,
  keys: string[],
  signal?: AbortSignal,
): Promise<RpcLedgerEntry[]> {
  const result = await rpcCall<{
    entries?: Array<{
      xdr?: string;
      lastModifiedLedgerSeq?: number;
      liveUntilLedgerSeq?: number;
    }>;
  }>(network, "getLedgerEntries", { keys }, signal);
  if (!Array.isArray(result?.entries)) {
    throw new UpstreamError("getLedgerEntries: malformed response body");
  }
  return result.entries.map((entry) => {
    if (
      typeof entry.xdr !== "string" ||
      typeof entry.lastModifiedLedgerSeq !== "number"
    ) {
      throw new UpstreamError("getLedgerEntries: malformed entry");
    }
    return {
      dataXdr: entry.xdr,
      lastModifiedLedgerSeq: entry.lastModifiedLedgerSeq,
      liveUntilLedgerSeq: entry.liveUntilLedgerSeq,
    };
  });
}

export interface RpcEvent {
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  /** base64 XDR ScVal, one per topic */
  topic: string[];
  /** base64 XDR ScVal */
  value: string;
}

export interface RpcEventsPage {
  events: RpcEvent[];
  /** absent once the requested range is fully read */
  cursor?: string;
}

/**
 * Events a contract raised itself -- never events from a contract it
 * called, and never a call that raised no event of its own. The first
 * page of a scan starts at `startLedger`; every page after continues
 * from the `cursor` the previous page returned, which also fixes the
 * filter, so only one of the two is ever sent.
 */
export async function fetchEvents(
  network: NetworkId,
  contractId: string,
  range: { startLedger: number } | { cursor: string },
  limit: number,
  signal?: AbortSignal,
): Promise<RpcEventsPage> {
  const result = await rpcCall<{
    events?: Array<{
      ledger?: number;
      ledgerClosedAt?: string;
      txHash?: string;
      topic?: string[];
      value?: string;
    }>;
    cursor?: string;
  }>(
    network,
    "getEvents",
    {
      ...("startLedger" in range ? { startLedger: range.startLedger } : {}),
      filters: [{ type: "contract", contractIds: [contractId] }],
      pagination:
        "cursor" in range ? { cursor: range.cursor, limit } : { limit },
    },
    signal,
  );
  if (!Array.isArray(result?.events)) {
    throw new UpstreamError("getEvents: malformed response body");
  }
  const events = result.events.map((event) => {
    if (
      typeof event.ledger !== "number" ||
      typeof event.ledgerClosedAt !== "string" ||
      typeof event.txHash !== "string" ||
      !Array.isArray(event.topic) ||
      typeof event.value !== "string"
    ) {
      throw new UpstreamError("getEvents: malformed entry");
    }
    return {
      ledger: event.ledger,
      ledgerClosedAt: event.ledgerClosedAt,
      txHash: event.txHash,
      topic: event.topic,
      value: event.value,
    };
  });
  return { events, cursor: result.cursor };
}
