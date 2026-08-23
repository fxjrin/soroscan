import { fetchJsonWithFailover, UpstreamError } from "@/lib/failover";
import { NETWORKS, type NetworkId } from "@/lib/network";

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`not found: ${path}`);
    this.name = "NotFoundError";
  }
}

export interface HorizonPage<T> {
  _embedded: { records: T[] };
}

// Horizon string-encodes int64 fields; future record types must keep them typed string
export interface LedgerRecord {
  sequence: number;
  hash: string;
  closed_at: string;
  successful_transaction_count: number;
  failed_transaction_count: number;
  operation_count: number;
  protocol_version: number;
  paging_token: string;
}

export async function horizonGet<T>(
  network: NetworkId,
  path: string,
  params?: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<T> {
  const query = params
    ? "?" +
      new URLSearchParams(
        Object.entries(params).map(([name, value]) => [name, String(value)]),
      ).toString()
    : "";
  const { status, ok, body } = await fetchJsonWithFailover<T>(
    NETWORKS[network].horizonUrls,
    path + query,
    { headers: { Accept: "application/json" } },
    signal,
  );
  if (status === 404) {
    throw new NotFoundError(path);
  }
  if (!ok) {
    throw new UpstreamError(`horizon ${status} for ${path}`, status);
  }
  return body;
}

export interface TxRecord {
  hash: string;
  paging_token: string;
  successful: boolean;
  source_account: string;
  operation_count: number;
  created_at: string;
  fee_charged: string;
}

export function fetchLatestLedgers(
  network: NetworkId,
  limit: number,
  signal?: AbortSignal,
) {
  return horizonGet<HorizonPage<LedgerRecord>>(
    network,
    "/ledgers",
    { order: "desc", limit },
    signal,
  );
}

export function fetchLatestTransactions(
  network: NetworkId,
  limit: number,
  signal?: AbortSignal,
) {
  return horizonGet<HorizonPage<TxRecord>>(
    network,
    "/transactions",
    { order: "desc", limit, include_failed: "true" },
    signal,
  );
}
