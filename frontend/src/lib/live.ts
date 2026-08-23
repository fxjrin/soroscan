import { useEffect, useState } from "react";
import { NETWORKS, type NetworkId } from "@/lib/network";

export type StreamStatus = "connecting" | "live" | "paused";

export interface StreamOptions<T> {
  path: string;
  cap: number;
  fetchInitial: (signal: AbortSignal) => Promise<T[]>;
  keyOf: (record: T) => string;
}

/**
 * Prepends incoming records (newest first) onto the list, dropping
 * duplicates by key and capping the result.
 */
export function mergeRecords<T>(
  existing: T[],
  incoming: T[],
  keyOf: (record: T) => string,
  cap: number,
): T[] {
  if (incoming.length === 0) {
    return existing;
  }
  const seen = new Set(incoming.map(keyOf));
  return [
    ...incoming,
    ...existing.filter((record) => !seen.has(keyOf(record))),
  ].slice(0, cap);
}

export function averageCloseSeconds(closedAts: string[]): number | undefined {
  if (closedAts.length < 2) {
    return undefined;
  }
  const times = closedAts.map((iso) => Date.parse(iso));
  let total = 0;
  for (let i = 0; i < times.length - 1; i++) {
    total += times[i] - times[i + 1];
  }
  return Math.round(total / (times.length - 1) / 100) / 10;
}

const FLUSH_MS = 500; // batch stream events so a busy ledger paints once, not 200 times
const PAUSED_POLL_MS = 15000;
const STALE_GAP_MS = 60000;
const MAX_STREAM_ERRORS = 4;

/**
 * Tails a Horizon SSE collection: seeds from a REST page, then streams
 * from cursor=now with Last-Event-ID style resumption, closes while the
 * tab is hidden, and degrades to slow polling when the stream keeps
 * failing. fetchInitial and keyOf must be stable references.
 */
export function useHorizonStream<T>(
  network: NetworkId,
  { path, cap, fetchInitial, keyOf }: StreamOptions<T>,
) {
  const [records, setRecords] = useState<T[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");

  useEffect(() => {
    const base = NETWORKS[network].horizonUrls[0];
    const separator = path.includes("?") ? "&" : "?";
    const state = {
      buffer: [] as T[],
      lastToken: "now",
      lastEventAt: 0,
      errors: 0,
    };
    const controller = new AbortController();
    let source: EventSource | null = null;
    let pollTimer: number | undefined;
    let disposed = false;

    function flush() {
      if (state.buffer.length === 0) {
        return;
      }
      const incoming = state.buffer.splice(0).reverse();
      setRecords((previous) => mergeRecords(previous, incoming, keyOf, cap));
    }

    async function refreshInitial() {
      try {
        const list = await fetchInitial(controller.signal);
        if (!disposed) {
          setRecords((previous) => mergeRecords(previous, list, keyOf, cap));
        }
      } catch {
        // keep whatever is on screen; the stream or the next poll may recover
      }
    }

    function open(cursor: string) {
      source?.close();
      source = new EventSource(
        `${base}${path}${separator}cursor=${encodeURIComponent(cursor)}&limit=200`,
      );
      source.onopen = () => {
        state.errors = 0;
        if (!disposed) {
          setStatus("live");
        }
      };
      source.onmessage = (event) => {
        state.lastEventAt = Date.now();
        if (event.lastEventId) {
          state.lastToken = event.lastEventId;
        }
        try {
          state.buffer.push(JSON.parse(event.data) as T);
        } catch {
          // hello/byebye frames are not records
        }
      };
      source.onerror = () => {
        state.errors += 1;
        if (state.errors >= MAX_STREAM_ERRORS) {
          source?.close();
          if (!disposed) {
            setStatus("paused");
          }
          pollTimer ??= window.setInterval(
            () => void refreshInitial(),
            PAUSED_POLL_MS,
          );
        }
      };
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        source?.close();
        source = null;
        return;
      }
      if (pollTimer !== undefined) {
        return;
      }
      if (Date.now() - state.lastEventAt > STALE_GAP_MS) {
        void refreshInitial();
        open("now");
      } else {
        open(state.lastToken);
      }
    }

    void refreshInitial();
    open("now");
    const flushTimer = window.setInterval(flush, FLUSH_MS);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      controller.abort();
      source?.close();
      window.clearInterval(flushTimer);
      window.clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [network, path, cap, fetchInitial, keyOf]);

  return { records, status };
}
