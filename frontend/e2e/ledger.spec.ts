import { expect, test, type Route } from "@playwright/test";
import { blockLiveHosts } from "./hermetic";

const HORIZON = "https://horizon.stellar.org/**";
const HORIZON_FALLBACK = "https://horizon.stellar.lobstr.co/**";
const RPC = "https://mainnet.sorobanrpc.com/**";

const LEDGER = {
  sequence: 64000000,
  hash: "b1c2d3e4f5b1c2d3e4f5b1c2d3e4f5b1c2d3e4f5b1c2d3e4f5b1c2d3e4f5b1c2",
  closed_at: "2026-08-18T10:00:00Z",
  successful_transaction_count: 185,
  failed_transaction_count: 30,
  operation_count: 902,
  protocol_version: 27,
  paging_token: "274877906944",
};

const NOT_FOUND = { status: 404, json: { title: "Resource Missing" } };

function healthRoute(latestLedger: () => number) {
  return (route: Route) => {
    const id = (route.request().postDataJSON() as { id: number }).id;
    return route.fulfill({
      json: {
        jsonrpc: "2.0",
        id,
        result: {
          status: "healthy",
          latestLedger: latestLedger(),
          latestLedgerCloseTime: 1756000000,
          oldestLedger: 63000000,
          oldestLedgerCloseTime: 1755000000,
          ledgerRetentionWindow: 120960,
        },
      },
    });
  };
}

test.beforeEach(async ({ page }) => {
  await blockLiveHosts(page);
});

test("renders a closed ledger from horizon", async ({ page }) => {
  await page.route(HORIZON, (route) => route.fulfill({ json: LEDGER }));

  await page.goto("/ledger/64000000");

  await expect(page.getByText("185 succeeded, 30 failed")).toBeVisible();
  await expect(page.getByText("Aug 18, 2026, 10:00:00 UTC")).toBeVisible();
  await expect(page.getByText("b1c2...b1c2")).toBeVisible();
});

test("a future ledger explains it has not closed yet", async ({ page }) => {
  await page.route(HORIZON, (route) => route.fulfill(NOT_FOUND));
  await page.route(HORIZON_FALLBACK, (route) => route.fulfill(NOT_FOUND));
  await page.route(
    RPC,
    healthRoute(() => 64000000),
  );

  await page.goto("/ledger/4000000000");

  await expect(page.getByText(/has not closed yet/)).toBeVisible();
  await expect(page.getByText("64,000,000")).toBeVisible();
});

test("a truncated old ledger explains the retention window", async ({
  page,
}) => {
  await page.route(HORIZON, (route) => route.fulfill(NOT_FOUND));
  await page.route(HORIZON_FALLBACK, (route) => route.fulfill(NOT_FOUND));
  await page.route(
    RPC,
    healthRoute(() => 64000000),
  );

  await page.goto("/ledger/123");

  await expect(page.getByText(/older than the data provider/)).toBeVisible();
});

test("a future ledger resolves itself once the network catches up", async ({
  page,
}) => {
  let ledgerCalls = 0;
  let networkHeight = 63999999;
  await page.route(HORIZON, (route) => {
    ledgerCalls += 1;
    if (ledgerCalls === 1) {
      return route.fulfill(NOT_FOUND);
    }
    return route.fulfill({ json: { ...LEDGER, sequence: 64000001 } });
  });
  await page.route(HORIZON_FALLBACK, (route) => route.fulfill(NOT_FOUND));
  await page.route(
    RPC,
    healthRoute(() => {
      networkHeight += 1; // each 5s poll advances the mocked chain
      return networkHeight;
    }),
  );

  await page.goto("/ledger/64000001");

  await expect(page.getByText(/has not closed yet/)).toBeVisible();
  await expect(page.getByText("185 succeeded, 30 failed")).toBeVisible({
    timeout: 15000,
  });
});
