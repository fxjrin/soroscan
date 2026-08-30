import { QueryClient, queryOptions } from "@tanstack/react-query";
import {
  fetchAccount,
  fetchAccountOffers,
  fetchAccountOperations,
  fetchTransactionMeta,
  fetchLatestLedgers,
  fetchLatestOperations,
  fetchLatestTransactions,
  fetchLedger,
  fetchTransaction,
  fetchTransactionEffects,
  fetchTransactionOperations,
  NotFoundError,
} from "@/lib/horizon/client";
import {
  buildActivityRows,
  presentOperation,
  type ActivityRow,
} from "@/lib/activity";
import { chainNow } from "@/lib/clock";
import {
  fetchFeeStats,
  fetchHealth,
  fetchLedgerEntries,
  fetchRpcTransaction,
} from "@/lib/rpc/client";
import type { HistoryEntry } from "@/lib/history";
import { fetchContractTransactions } from "@/lib/indexer/client";
import {
  contractCodeKey,
  contractInstanceKey,
  contractInterface,
  decodeContractCode,
  decodeContractInstance,
  type ContractCode,
  type ContractInterfaceInfo,
  type ContractInstance,
} from "@/lib/contract";
import { decodeReturnValue } from "@/lib/tx-meta";
import { fetchArchivedMeta } from "@/lib/ledger-lake";
import { decodeTrace, type TxTrace } from "@/lib/tx-trace";
import { decodeXdrJson } from "@/lib/xdr-decode";
import type { ScDisplay } from "@/lib/scval";
import type { NetworkId } from "@/lib/network";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false, // one attempt already rotates through every provider
      refetchOnWindowFocus: false,
    },
  },
});

const LEDGER_CLOSE_MS = 5000;
const ERROR_BACKOFF_MS = 30_000;

const EXPECTED_DETECT_MS = 7500; // one cadence (~5.5s) + RPC ingest lag (~2s)

/**
 * Cadence-locked polling: aim one poll at the moment the next ledger
 * should be visible to RPC, then burst every 500ms only while overdue.
 * Faster detection than a fixed grid with fewer requests overall.
 */
export function nextHealthPollDelay(
  closeTimeSec: number,
  nowMs: number,
): number {
  if (!Number.isFinite(closeTimeSec)) {
    return 2500;
  }
  const nextDetectMs = closeTimeSec * 1000 + EXPECTED_DETECT_MS;
  return Math.min(8000, Math.max(500, nextDetectMs - nowMs));
}

// RPC detects a new ledger ~2s after close while Horizon SSE delivers it
// ~5s after, so this is the low-latency heartbeat for the ring and the
// latest-ledger number
export function healthQuery(network: NetworkId) {
  return queryOptions({
    queryKey: [network, "rpc", "health"],
    queryFn: ({ signal }) => fetchHealth(network, signal),
    refetchInterval: (query) => {
      if (query.state.status === "error") {
        return ERROR_BACKOFF_MS;
      }
      const data = query.state.data;
      if (!data) {
        return 2000;
      }
      return nextHealthPollDelay(
        Number(data.latestLedgerCloseTime),
        chainNow(),
      );
    },
    staleTime: 400,
  });
}

export function feeStatsQuery(network: NetworkId) {
  return queryOptions({
    queryKey: [network, "rpc", "fee-stats"],
    queryFn: ({ signal }) => fetchFeeStats(network, signal),
    refetchInterval: (query) =>
      query.state.status === "error" ? ERROR_BACKOFF_MS : 30_000,
    staleTime: 25_000,
  });
}

export function ledgerQuery(network: NetworkId, sequence: string) {
  return queryOptions({
    queryKey: [network, "horizon", "ledger", sequence],
    queryFn: ({ signal }) => fetchLedger(network, sequence, signal),
    staleTime: Infinity, // a closed ledger is immutable
  });
}

const OPS_LOOKBACK = 25; // first ops for ~8 txs without joining heavy tx envelopes

// one mass-payout tx can hold 100+ operations and eat the whole lookback,
// leaving the other rows untyped; those few fetch their first op directly
async function fillMissingOps(
  network: NetworkId,
  rows: ActivityRow[],
  signal: AbortSignal,
): Promise<ActivityRow[]> {
  const fetched = await Promise.all(
    rows.map(async (row) => {
      if (row.op !== undefined) {
        return row; // hashes were already shape-checked in buildActivityRows
      }
      try {
        const page = await fetchTransactionOperations(
          network,
          row.tx.hash,
          1,
          signal,
        );
        const op = page._embedded.records[0];
        return op === undefined ? row : { ...row, op: presentOperation(op) };
      } catch {
        return row; // an untyped row beats failing the whole feed
      }
    }),
  );
  return fetched;
}

// polled, not streamed: Horizon tx records carry full XDR envelopes, so a
// mainnet-volume SSE feed moves hundreds of KB per reconnect for 8 rows;
// an operations lookback rides the same beat to say what each tx does
export function latestActivityQuery(network: NetworkId, limit: number) {
  return queryOptions({
    queryKey: [network, "horizon", "activity", "latest", limit],
    queryFn: async ({ signal }) => {
      const [txs, ops] = await Promise.all([
        fetchLatestTransactions(network, limit, signal),
        fetchLatestOperations(network, OPS_LOOKBACK, signal),
      ]);
      const rows = buildActivityRows(
        txs._embedded.records,
        ops._embedded.records,
      );
      return fillMissingOps(network, rows, signal);
    },
    refetchInterval: (query) =>
      query.state.status === "error" ? ERROR_BACKOFF_MS : LEDGER_CLOSE_MS,
    staleTime: LEDGER_CLOSE_MS - 1000,
  });
}

export function txQuery(network: NetworkId, hash: string) {
  return queryOptions({
    queryKey: [network, "horizon", "tx", hash],
    queryFn: ({ signal }) => fetchTransaction(network, hash, signal),
    staleTime: Infinity, // a confirmed transaction is immutable
    // a just-submitted transaction reaches Horizon within seconds; keep
    // looking while the page is open instead of leaving a stale 404
    refetchInterval: (query) =>
      query.state.error instanceof NotFoundError ? 10_000 : false,
  });
}

export function txOperationsQuery(network: NetworkId, hash: string) {
  return queryOptions({
    queryKey: [network, "horizon", "tx", hash, "operations"],
    queryFn: ({ signal }) =>
      fetchTransactionOperations(network, hash, 200, signal),
    staleTime: Infinity,
  });
}

export interface SorobanDetails {
  returnValue: ScDisplay | null;
  trace: TxTrace | null;
}

// return value and call trace both live in the transaction meta, which
// Horizon no longer serves; one RPC fetch covers both, and for meta
// outside the retention window the trace falls back to the envelope
export interface TxSources {
  /** lets a trace fall back to the signed authorization entries */
  envelopeXdr?: string;
  /** lets the public archive be asked for meta RPC no longer has */
  ledger?: number;
}

export function txSorobanQuery(
  network: NetworkId,
  hash: string,
  sources: TxSources = {},
) {
  const { envelopeXdr, ledger } = sources;
  return queryOptions({
    // the envelope is part of the identity: without it a trace cannot fall
    // back to the authorization entries, so a caller that has no envelope
    // must not leave its thinner answer in the cache for one that does
    queryKey: [
      network,
      "rpc",
      "tx",
      hash,
      "soroban",
      envelopeXdr === undefined ? "meta" : "meta+envelope",
      ledger === undefined ? "live" : "archived",
    ],
    queryFn: async ({ signal }): Promise<SorobanDetails> => {
      const tx = await fetchRpcTransaction(network, hash, signal);
      // RPC drops meta after about a week. The public ledger archive keeps
      // the whole history and, unlike Horizon, its meta still carries the
      // diagnostic events a nested call tree is built from, so it is asked
      // first and Horizon is the last resort
      const live = tx.status === "NOT_FOUND" ? undefined : tx.resultMetaXdr;
      const metaXdr =
        live ??
        (ledger === undefined
          ? undefined
          : await fetchArchivedMeta(network, ledger, hash, signal)) ??
        (await fetchTransactionMeta(network, hash, signal));
      const returnValue =
        tx.status === "SUCCESS" && metaXdr !== undefined
          ? await decodeReturnValue(metaXdr)
          : undefined;
      const trace = await decodeTrace(metaXdr, envelopeXdr);
      return { returnValue: returnValue ?? null, trace: trace ?? null };
    },
    staleTime: Infinity, // a confirmed transaction's meta is immutable
  });
}

export interface DecodedXdr {
  envelope: unknown;
  result: unknown;
  feeMeta: unknown;
}

// a confirmed transaction never changes, so its decoded form is worth
// keeping once the xdr chunk has been paid for
export function txDecodedXdrQuery(
  network: NetworkId,
  hash: string,
  blobs: { envelope?: string; result?: string; feeMeta?: string },
) {
  return queryOptions({
    queryKey: [network, "xdr", "decoded", hash],
    queryFn: async (): Promise<DecodedXdr> => ({
      envelope:
        blobs.envelope === undefined
          ? undefined
          : await decodeXdrJson(blobs.envelope, "TransactionEnvelope"),
      result:
        blobs.result === undefined
          ? undefined
          : await decodeXdrJson(blobs.result, "TransactionResult"),
      feeMeta:
        blobs.feeMeta === undefined
          ? undefined
          : await decodeXdrJson(blobs.feeMeta, "LedgerEntryChanges"),
    }),
    staleTime: Infinity,
  });
}

export function txEffectsQuery(network: NetworkId, hash: string) {
  return queryOptions({
    queryKey: [network, "horizon", "tx", hash, "effects"],
    queryFn: ({ signal }) =>
      fetchTransactionEffects(network, hash, 200, signal),
    staleTime: Infinity,
  });
}

export function latestLedgersQuery(network: NetworkId, limit: number) {
  return queryOptions({
    queryKey: [network, "horizon", "ledgers", "latest", limit],
    queryFn: ({ signal }) => fetchLatestLedgers(network, limit, signal),
    refetchInterval: (query) =>
      query.state.status === "error" ? ERROR_BACKOFF_MS : LEDGER_CLOSE_MS,
    staleTime: LEDGER_CLOSE_MS - 1000,
  });
}

// an account is tip-of-chain: its balances and sequence move with the
// network, so it gets a short staleness rather than the permanent cache a
// confirmed transaction earns
export function accountQuery(network: NetworkId, address: string) {
  return queryOptions({
    queryKey: [network, "horizon", "account", address],
    queryFn: ({ signal }) => fetchAccount(network, address, signal),
    staleTime: LEDGER_CLOSE_MS,
  });
}

// history is walked page by page rather than accumulated, so each page is
// its own cache entry and going back is free
export function accountOperationsQuery(
  network: NetworkId,
  address: string,
  limit: number,
  cursor?: string,
) {
  return queryOptions({
    queryKey: [network, "horizon", "account", address, "operations", cursor],
    queryFn: ({ signal }) =>
      fetchAccountOperations(network, address, limit, cursor, signal),
    staleTime: LEDGER_CLOSE_MS,
  });
}

// an open offer is live state: it can be taken or cancelled at any moment,
// so it gets the same short staleness the account itself does
export function accountOffersQuery(
  network: NetworkId,
  address: string,
  limit: number,
  cursor?: string,
) {
  return queryOptions({
    queryKey: [network, "horizon", "account", address, "offers", cursor],
    queryFn: ({ signal }) =>
      fetchAccountOffers(network, address, limit, cursor, signal),
    staleTime: LEDGER_CLOSE_MS,
  });
}

export interface ContractInstanceDetails {
  /** undefined when no live entry exists: never deployed, or deployed and
   * since archived for going unread past its ttl */
  instance: ContractInstance | undefined;
  lastModifiedLedgerSeq?: number;
  liveUntilLedgerSeq?: number;
}

// the instance is live ledger state, not a historical lookup: it does not
// age out the way a transaction's meta does, so this reads current state
// on the same short cadence account balances do
export function contractInstanceQuery(network: NetworkId, contractId: string) {
  return queryOptions({
    queryKey: [network, "rpc", "contract", contractId, "instance"],
    queryFn: async ({ signal }): Promise<ContractInstanceDetails> => {
      const key = await contractInstanceKey(contractId);
      const [entry] = await fetchLedgerEntries(network, [key], signal);
      if (entry === undefined) {
        return { instance: undefined };
      }
      return {
        instance: await decodeContractInstance(entry.dataXdr),
        lastModifiedLedgerSeq: entry.lastModifiedLedgerSeq,
        liveUntilLedgerSeq: entry.liveUntilLedgerSeq,
      };
    },
    staleTime: LEDGER_CLOSE_MS,
  });
}

export interface ContractCodeDetails {
  code: ContractCode | undefined;
  /** undefined when the wasm has no spec section, or is too malformed to parse */
  interface: ContractInterfaceInfo | undefined;
}

// keyed by hash alone, not by contract id: every contract deployed from
// the same wasm shares this entry, and the wasm at a given hash never
// changes once it exists
export function contractCodeQuery(network: NetworkId, wasmHash: string) {
  return queryOptions({
    queryKey: [network, "rpc", "contract-code", wasmHash],
    queryFn: async ({ signal }): Promise<ContractCodeDetails> => {
      const key = await contractCodeKey(wasmHash);
      const [entry] = await fetchLedgerEntries(network, [key], signal);
      const code =
        entry === undefined
          ? undefined
          : await decodeContractCode(entry.dataXdr);
      const contractInterfaceInfo =
        code === undefined
          ? undefined
          : await contractInterface(code.wasmBytes);
      return { code, interface: contractInterfaceInfo };
    },
    staleTime: Infinity,
  });
}

export interface ContractInvocations {
  /** one row per top-level invocation of the contract, most recent first */
  entries: HistoryEntry[];
  /** how many transactions the indexer page held before Horizon lookups */
  txCount: number;
  nextCursor?: string;
}

/**
 * Transactions that invoked this contract directly, newest first, across
 * the contract's entire history. A cross-contract call does not appear
 * here: the contract the transaction invoked directly is the one indexed.
 */
export function contractInvocationsQuery(
  network: NetworkId,
  contractId: string,
  cursor?: string,
) {
  return queryOptions({
    queryKey: [
      network,
      "indexer",
      "contract",
      contractId,
      "invocations",
      cursor,
    ],
    queryFn: async ({ signal }): Promise<ContractInvocations> => {
      const page = await fetchContractTransactions(
        network,
        contractId,
        cursor,
        signal,
      );
      const operations = await Promise.all(
        page.transactions.map(async (transaction) => {
          try {
            const operationsPage = await fetchTransactionOperations(
              network,
              transaction.txHash,
              1,
              signal,
            );
            return operationsPage._embedded.records[0];
          } catch {
            return undefined; // one unreachable transaction should not sink the page
          }
        }),
      );
      const entries: HistoryEntry[] = [];
      page.transactions.forEach((transaction, index) => {
        const operation = operations[index];
        if (operation !== undefined) {
          entries.push({
            hash: transaction.txHash,
            lastToken: operation.paging_token,
            operations: [operation],
          });
        }
      });
      return {
        entries,
        txCount: page.transactions.length,
        nextCursor: page.nextCursor,
      };
    },
    // pages behind a cursor are settled history; only the newest page moves
    staleTime: cursor === undefined ? LEDGER_CLOSE_MS : Infinity,
  });
}
