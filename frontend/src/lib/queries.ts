import { QueryClient, queryOptions } from "@tanstack/react-query";
import {
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
  fetchRpcTransaction,
} from "@/lib/rpc/client";
import { decodeReturnValue } from "@/lib/tx-meta";
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
export function txSorobanQuery(
  network: NetworkId,
  hash: string,
  envelopeXdr?: string,
) {
  return queryOptions({
    queryKey: [network, "rpc", "tx", hash, "soroban"],
    queryFn: async ({ signal }): Promise<SorobanDetails> => {
      const tx = await fetchRpcTransaction(network, hash, signal);
      const metaXdr = tx.status === "NOT_FOUND" ? undefined : tx.resultMetaXdr;
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
