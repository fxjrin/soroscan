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
