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
  latestLedgerCloseTime: number;
  oldestLedger: number;
  oldestLedgerCloseTime: number;
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
