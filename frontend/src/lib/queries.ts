import { QueryClient, queryOptions } from "@tanstack/react-query";
import {
  fetchLatestLedgers,
  horizonGet,
  type LedgerRecord,
} from "@/lib/horizon/client";
import { fetchHealth } from "@/lib/rpc/client";
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

export function healthQuery(network: NetworkId) {
  return queryOptions({
    queryKey: [network, "rpc", "health"],
    queryFn: ({ signal }) => fetchHealth(network, signal),
    refetchInterval: (query) =>
      query.state.status === "error" ? ERROR_BACKOFF_MS : LEDGER_CLOSE_MS,
    staleTime: LEDGER_CLOSE_MS - 1000,
  });
}

export function ledgerQuery(network: NetworkId, sequence: string) {
  return queryOptions({
    queryKey: [network, "horizon", "ledger", sequence],
    queryFn: ({ signal }) =>
      horizonGet<LedgerRecord>(
        network,
        `/ledgers/${sequence}`,
        undefined,
        signal,
      ),
    staleTime: Infinity, // a closed ledger is immutable
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
