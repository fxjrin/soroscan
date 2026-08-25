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
  fee_pool?: string;
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

function isLedger(body: unknown): body is LedgerRecord {
  const ledger = body as LedgerRecord | null;
  return (
    typeof ledger === "object" &&
    ledger !== null &&
    typeof ledger.hash === "string" &&
    typeof ledger.closed_at === "string" &&
    typeof ledger.sequence === "number"
  );
}

/** The caller must validate the sequence shape before interpolating it. */
export async function fetchLedger(
  network: NetworkId,
  sequence: string,
  signal?: AbortSignal,
): Promise<LedgerRecord> {
  const ledger = await horizonGet<unknown>(
    network,
    `/ledgers/${sequence}`,
    undefined,
    signal,
  );
  if (!isLedger(ledger)) {
    throw new UpstreamError(`ledger ${sequence}: malformed response body`);
  }
  return ledger;
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

// operation records are polymorphic per type; the optional fields cover
// the variants the activity feed presents, unknown types pass through
export interface OperationRecord {
  id: string;
  paging_token: string;
  transaction_hash: string;
  type: string;
  source_account: string;
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  funder?: string;
  account?: string;
  starting_balance?: string;
  into?: string;
  address?: string;
  function?: string;
  parameters?: Array<{ type: string; value: string }>;
  asset_balance_changes?: Array<{
    type: string;
    from?: string;
    to?: string;
    amount?: string;
    asset_type?: string;
    asset_code?: string;
  }>;
  selling_asset_type?: string;
  selling_asset_code?: string;
  buying_asset_type?: string;
  buying_asset_code?: string;
  trustor?: string;
  trustee?: string;
  asset_issuer?: string;
  asset?: string;
}

export function fetchLatestOperations(
  network: NetworkId,
  limit: number,
  signal?: AbortSignal,
) {
  return horizonGet<HorizonPage<OperationRecord>>(
    network,
    "/operations",
    { order: "desc", limit, include_failed: "true" },
    signal,
  );
}

// the detail view needs more of the record than the feed does
export interface TxDetailRecord extends TxRecord {
  ledger: number;
  max_fee: string;
  memo_type: string;
  memo?: string;
  source_account_sequence: string;
  fee_account?: string;
  signatures?: string[];
  envelope_xdr?: string;
  result_xdr?: string;
  fee_meta_xdr?: string;
}

// effects are horizon's decoded balance movements for a transaction
export interface EffectRecord {
  id: string;
  type: string;
  account?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  /** set on contract effects: the balance that moved belongs to this contract */
  contract?: string;
  _links?: { operation?: { href?: string } };
}

export function fetchTransactionEffects(
  network: NetworkId,
  hash: string,
  limit: number,
  signal?: AbortSignal,
) {
  return horizonGet<HorizonPage<EffectRecord>>(
    network,
    `/transactions/${hash}/effects`,
    { order: "asc", limit },
    signal,
  );
}

// the detail page renders these fields without further guarding, so a
// body missing them has to fail the query here rather than reach the
// page and throw from inside a formatter
function isTxDetail(body: unknown): body is TxDetailRecord {
  const tx = body as TxDetailRecord | null;
  return (
    typeof tx === "object" &&
    tx !== null &&
    typeof tx.hash === "string" &&
    typeof tx.successful === "boolean" &&
    typeof tx.source_account === "string" &&
    typeof tx.source_account_sequence === "string" &&
    typeof tx.created_at === "string" &&
    typeof tx.fee_charged === "string" &&
    typeof tx.max_fee === "string" &&
    typeof tx.memo_type === "string" &&
    typeof tx.operation_count === "number"
  );
}

/** The caller must validate the hash shape before interpolating it. */
export async function fetchTransaction(
  network: NetworkId,
  hash: string,
  signal?: AbortSignal,
): Promise<TxDetailRecord> {
  const tx = await horizonGet<unknown>(
    network,
    `/transactions/${hash}`,
    undefined,
    signal,
  );
  if (!isTxDetail(tx)) {
    throw new UpstreamError(`transaction ${hash}: malformed response body`);
  }
  return tx;
}

export function fetchTransactionOperations(
  network: NetworkId,
  hash: string,
  limit: number,
  signal?: AbortSignal,
) {
  return horizonGet<HorizonPage<OperationRecord>>(
    network,
    `/transactions/${hash}/operations`,
    { order: "asc", limit },
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
