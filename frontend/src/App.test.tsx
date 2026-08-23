import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";
import { resetFailoverState } from "@/lib/failover";

beforeEach(() => {
  resetFailoverState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

test("renders the app shell while offline", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("offline"))),
  );

  renderApp();

  expect(screen.getByText("Soroscan")).toBeDefined();
});

test("shows the live ledger height when rpc responds", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            status: "healthy",
            latestLedger: 55443322,
            latestLedgerCloseTime: 1,
            oldestLedger: 1,
            oldestLedgerCloseTime: 1,
            ledgerRetentionWindow: 120960,
          },
        }),
        { status: 200 },
      );
    }),
  );

  renderApp();

  expect(await screen.findByText("ledger 55,443,322")).toBeDefined();
});
