import { fetchJsonWithFailover, UpstreamError } from "@/lib/failover";
import { NETWORKS, type NetworkId } from "@/lib/network";

export interface IndexedTransaction {
  txHash: string;
  ledger: number;
  closedAt: string;
  functionName: string;
  args: unknown;
  /** stroops as a string: 64-bit values must never touch a js number */
  feeCharged: string;
}

export interface IndexedTransactionsPage {
  transactions: IndexedTransaction[];
  /** a ledger sequence; absent once the history is fully read */
  nextCursor?: string;
}

export const INDEXER_PAGE = 20;

export function indexerAvailable(network: NetworkId): boolean {
  return NETWORKS[network].indexerUrls.length > 0;
}

/**
 * Top-level invocations of a contract, newest first, across its full
 * history. A transaction appears only when it invoked the contract
 * directly, never when the contract ran inside a cross-contract call.
 */
export async function fetchContractTransactions(
  network: NetworkId,
  contractId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<IndexedTransactionsPage> {
  const urls = NETWORKS[network].indexerUrls;
  if (urls.length === 0) {
    throw new UpstreamError(`no indexer for ${network}`);
  }
  const params = new URLSearchParams({ limit: String(INDEXER_PAGE) });
  if (cursor !== undefined) {
    params.set("cursor", cursor);
  }
  const { ok, status, body } = await fetchJsonWithFailover<{
    transactions?: Array<{
      tx_hash?: string;
      ledger?: number;
      closed_at?: string;
      function?: string;
      args?: unknown;
      fee_charged?: string;
    }>;
    next_cursor?: string;
    error?: string;
  }>(
    urls,
    `/contracts/${contractId}/transactions?${params.toString()}`,
    undefined,
    signal,
  );
  if (!ok) {
    throw new UpstreamError(
      typeof body?.error === "string"
        ? body.error
        : `indexer responded ${status}`,
      status,
    );
  }
  if (!Array.isArray(body?.transactions)) {
    throw new UpstreamError("indexer: malformed response body");
  }
  const transactions = body.transactions.map((entry) => {
    if (
      typeof entry.tx_hash !== "string" ||
      typeof entry.ledger !== "number" ||
      typeof entry.closed_at !== "string" ||
      typeof entry.function !== "string" ||
      typeof entry.fee_charged !== "string"
    ) {
      throw new UpstreamError("indexer: malformed entry");
    }
    return {
      txHash: entry.tx_hash,
      ledger: entry.ledger,
      closedAt: entry.closed_at,
      functionName: entry.function,
      args: entry.args,
      feeCharged: entry.fee_charged,
    };
  });
  // opaque to this side: the indexer names a row in it and expects it
  // back verbatim
  return {
    transactions,
    nextCursor:
      typeof body.next_cursor === "string" ? body.next_cursor : undefined,
  };
}
