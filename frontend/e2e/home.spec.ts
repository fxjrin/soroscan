import { expect, test, type Route } from "@playwright/test";
import { blockLiveHosts, HORIZON_PROVIDERS, RPC_PROVIDERS } from "./hermetic";

const G1 = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const G2 = "GBEUJWAVFYLJZKTQTZHUPQE3PZBWSTRIRRWLIVCAJNL5FUEIIUYVJZ7F";
const C1 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function ledger(sequence: number, closedAt: string) {
  return {
    sequence,
    hash: "b1c2d3e4f5b1c2d3e4f5b1c2d3e4f5b1c2d3e4f5b1c2d3e4f5b1c2d3e4f5b1c2",
    closed_at: closedAt,
    successful_transaction_count: 180,
    failed_transaction_count: 20,
    operation_count: 400,
    protocol_version: 27,
    paging_token: String(sequence) + "000000000",
    fee_pool: (5126330 + (sequence - 64000000) * 0.005).toFixed(7),
  };
}

function tx(hash: string, pagingToken: string, successful: boolean) {
  return {
    hash,
    paging_token: pagingToken,
    successful,
    source_account: G1,
    operation_count: 1,
    created_at: "2026-08-23T19:30:00Z",
    fee_charged: "100",
  };
}

function sse(events: Array<{ id: string; data: object }>) {
  const frames = events
    .map((event) => `id: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`)
    .join("");
  return {
    status: 200,
    headers: { "content-type": "text/event-stream" },
    body: `retry: 300000\n\n${frames}`,
  };
}

function operations() {
  return {
    _embedded: {
      records: [
        {
          id: "2",
          paging_token: "200000001",
          transaction_hash: "aaaa".repeat(16),
          type: "payment",
          source_account: G1,
          from: G1,
          to: G2,
          amount: "12.5000000",
          asset_type: "native",
        },
        {
          id: "1",
          paging_token: "100000001",
          transaction_hash: "dddd".repeat(16),
          type: "invoke_host_function",
          source_account: G1,
          address: "",
          function: "HostFunctionTypeHostFunctionTypeInvokeContract",
          parameters: [
            {
              type: "Address",
              value: "AAAAEgAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQ==",
            },
            { type: "Sym", value: "AAAADwAAAAh0cmFuc2Zlcg==" },
          ],
          asset_balance_changes: [
            {
              type: "transfer",
              from: G1,
              to: C1,
              amount: "479.2500000",
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
            },
          ],
        },
      ],
    },
  };
}

function horizonHandler(route: Route) {
  const url = route.request().url();
  if (url.includes("/ledgers") && url.includes("cursor=now")) {
    return route.fulfill(
      sse([
        {
          id: "64000002000000000",
          data: ledger(64000002, "2026-08-23T19:30:11Z"),
        },
      ]),
    );
  }
  if (url.includes("/ledgers")) {
    return route.fulfill({
      json: {
        _embedded: {
          records: [
            ledger(64000001, "2026-08-23T19:30:05Z"),
            ledger(64000000, "2026-08-23T19:30:00Z"),
          ],
        },
      },
    });
  }
  if (url.includes("/transactions/") && url.includes("/operations")) {
    // the beef tx sits outside the ops lookback; its op comes per tx
    return route.fulfill({
      json: {
        _embedded: {
          records: [
            {
              id: "3",
              paging_token: "300000001",
              transaction_hash: "beef".repeat(16),
              type: "manage_sell_offer",
              source_account: G1,
              amount: "5.0000000",
              selling_asset_type: "credit_alphanum4",
              selling_asset_code: "US\u202EDC",
            },
          ],
        },
      },
    });
  }
  if (url.includes("/operations")) {
    return route.fulfill({ json: operations() });
  }
  if (url.includes("/transactions")) {
    txPolls += 1;
    const records =
      txPolls === 1
        ? [
            tx("aaaa".repeat(16), "tx2", true),
            tx("dddd".repeat(16), "tx1", false),
          ]
        : [
            tx("gggg".repeat(16), "tx4", true),
            tx("beef".repeat(16), "tx3", true),
            tx("aaaa".repeat(16), "tx2", true),
            tx("dddd".repeat(16), "tx1", false),
          ];
    return route.fulfill({ json: { _embedded: { records } } });
  }
  return route.abort();
}

let txPolls = 0;

function lowHealthRoute(route: Route) {
  const request = route.request().postDataJSON() as {
    id: number;
    method: string;
  };
  if (request.method === "getFeeStats") {
    return route.fulfill({
      json: {
        jsonrpc: "2.0",
        id: request.id,
        result: { inclusionFee: { p50: "250" } },
      },
    });
  }
  return route.fulfill({
    json: {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        status: "healthy",
        latestLedger: 63999000,
        latestLedgerCloseTime: 1756000000,
        oldestLedger: 63878040,
        oldestLedgerCloseTime: 1755000000,
        ledgerRetentionWindow: 120960,
      },
    },
  });
}

test.beforeEach(async ({ page }) => {
  txPolls = 0;
  await blockLiveHosts(page);
  for (const pattern of HORIZON_PROVIDERS) {
    await page.route(pattern, horizonHandler);
  }
  for (const pattern of RPC_PROVIDERS) {
    await page.route(pattern, lowHealthRoute);
  }
});

test("home shows seeded and streamed ledgers and transactions", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "64,000,000" })).toBeVisible();
  await expect(page.getByRole("link", { name: "64,000,002" })).toBeVisible();
  await expect(page.getByText("aaaaaaaaaa...aaaaaaaaaa")).toBeVisible();
  await expect(page.getByText("Payment")).toBeVisible();
  await expect(page.getByText("Contract call")).toBeVisible();
  await expect(page.getByText("12.5")).toBeVisible();
  await expect(page.getByText("CDLZ...CYSC")).toBeVisible();
  await expect(page.getByText("# transfer")).toBeVisible();
  await expect(page.getByText("479.25")).toBeVisible();
  await expect(page.getByText("beefbeefbe...efbeefbeef")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("DEX offer")).toBeVisible();
  await expect(page.getByText("order book")).toBeVisible();
  await expect(page.getByText("US\uFFFDDC")).toBeVisible();
  await expect(page.getByText("gggggggggg...gggggggggg")).toHaveCount(0);
  await expect(page.getByText("= 250 stroops")).toBeVisible();
  await expect(page.getByText("Burned").first()).toBeVisible();
  await expect(page.getByText("0.005 XLM").first()).toBeVisible();
  await expect(page.getByText("failed").first()).toBeVisible();
  await expect(page.getByText("live").first()).toBeVisible();
});

test("streamed head updates the latest-ledger stat", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByText("Latest ledger").locator("..").getByText("64,000,002"),
  ).toBeVisible({ timeout: 15000 });
});

test("ledger ring keeps draining after an arrival, never freezes", async ({
  page,
}) => {
  await page.goto("/");

  // settle on the streamed head first so no further remount lands mid-sample
  await expect(
    page.getByText("Latest ledger").locator("..").getByText("64,000,002"),
  ).toBeVisible({ timeout: 15000 });

  const ring = page.locator("circle.ring-progress");
  const offsetOf = () =>
    ring.evaluate((el) => parseFloat(getComputedStyle(el).strokeDashoffset));

  await page.waitForTimeout(700); // past the lap-completion and tail-drain sweeps
  const first = await offsetOf();
  await page.waitForTimeout(1000);
  const second = await offsetOf();

  expect(second).toBeGreaterThan(0); // frozen full would sit at 0
  expect(first).toBeGreaterThan(second); // frozen empty would not move
});
