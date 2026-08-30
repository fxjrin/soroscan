import { expect, test, type Route } from "@playwright/test";
import { blockLiveHosts, INDEXER } from "./hermetic";

const HORIZON = "https://horizon.stellar.org/**";
const HORIZON_FALLBACK = "https://horizon.stellar.lobstr.co/**";
const RPC = "https://mainnet.sorobanrpc.com/**";

const LEDGER = {
  sequence: 64000000,
  hash: "b1c2d3e4f5b1c2d3e4f5b1c2d3e4f5b1c2d3e4f5b1c2d3e4f5b1c2d3e4f5b1c2",
  prev_hash: "a0b1c2d3e4a0b1c2d3e4a0b1c2d3e4a0b1c2d3e4a0b1c2d3e4a0b1c2d3e4a0b1",
  closed_at: "2026-08-18T10:00:00Z",
  successful_transaction_count: 185,
  failed_transaction_count: 30,
  operation_count: 902,
  tx_set_operation_count: 1000,
  protocol_version: 27,
  paging_token: "274877906944",
  fee_pool: "10382649.5468203",
  total_coins: "105443902087.3472865",
  base_fee_in_stroops: 100,
  base_reserve_in_stroops: 5000000,
  max_tx_set_size: 1000,
};

const PREV_LEDGER = {
  ...LEDGER,
  sequence: 63999999,
  hash: LEDGER.prev_hash,
  closed_at: "2026-08-18T09:59:54.700Z",
  fee_pool: "10382649.0468203",
};

const INVOCATION_HASH = "aabb".repeat(16);
const CALLER = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const WASM_CONTRACT_SCVAL =
  "AAAAEgAAAAFNIKsMw7zmGPC92uDE1aDLQdRausW5Xc3sdSbdC4/uJQ==";
const HARVEST_SCVAL = "AAAADwAAAAdoYXJ2ZXN0AA=="; // symbol "harvest"

const OPERATIONS_PAGE = {
  _embedded: {
    records: [
      {
        id: "op-1",
        paging_token: "274877906944-1",
        transaction_hash: INVOCATION_HASH,
        transaction_successful: true,
        type: "invoke_host_function",
        source_account: CALLER,
        created_at: "2026-08-18T10:00:00Z",
        transaction: { fee_charged: "189", successful: true },
        address: "",
        function: "HostFunctionTypeHostFunctionTypeInvokeContract",
        parameters: [
          { type: "Address", value: WASM_CONTRACT_SCVAL },
          { type: "Sym", value: HARVEST_SCVAL },
        ],
      },
      {
        id: "op-2",
        paging_token: "274877906944-2",
        transaction_hash: "ccdd".repeat(16),
        transaction_successful: false,
        type: "payment",
        source_account: CALLER,
        created_at: "2026-08-18T10:00:00Z",
        transaction: { fee_charged: "100", successful: false },
        from: CALLER,
        to: CALLER,
        amount: "5.0000000",
        asset_type: "native",
      },
    ],
  },
};

const NOT_FOUND = { status: 404, json: { title: "Resource Missing" } };

function horizonHandler(route: Route) {
  const url = new URL(route.request().url());
  if (url.pathname === "/ledgers/64000000/operations") {
    return route.fulfill({ json: OPERATIONS_PAGE });
  }
  if (url.pathname === "/ledgers/64000000") {
    return route.fulfill({ json: LEDGER });
  }
  if (url.pathname === "/ledgers/63999999") {
    return route.fulfill({ json: PREV_LEDGER });
  }
  return route.fulfill(NOT_FOUND);
}

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

test("renders a closed ledger with stats, mix, and transactions", async ({
  page,
}) => {
  await page.route(HORIZON, horizonHandler);
  await page.route(
    RPC,
    healthRoute(() => 64100000),
  );
  await page.route(INDEXER, (route) =>
    route.fulfill({
      json: { invocations: 12, contracts: 3, functions: 4, indexed: true },
    }),
  );

  await page.goto("/ledger/64000000");

  // the same instant renders in the age column of every mocked row, so
  // the meta line assertion pins the first occurrence
  await expect(
    page.getByText("Aug 18, 2026, 10:00:00 UTC").first(),
  ).toBeVisible();
  // the close duration comes from the gap to the previous ledger
  await expect(page.getByText("5.3s")).toBeVisible();
  await expect(page.getByText("+30")).toBeVisible();
  await expect(page.getByText("of 1,000 submitted")).toBeVisible();
  // the soroban stats come from the soroscan indexer, not horizon
  await expect(page.getByText("3 contracts")).toBeVisible();
  await expect(page.getByText("XLM collected")).toBeVisible();
  // the ledger map draws one square per transaction, linked to its page
  await expect(
    page.getByRole("link", { name: /Payment failed transaction/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Each square is one transaction", { exact: false }),
  ).toBeVisible();
  // the transaction list reuses the shared history rows
  await expect(page.getByText("harvest(")).toBeVisible();

  // raw header data hides behind a disclosure, linked prev hash included
  await expect(page.getByText("Fee pool")).not.toBeVisible();
  await page.getByText("Show ledger internals").click();
  await expect(page.getByText("Fee pool")).toBeVisible();
  await expect(page.getByRole("link", { name: "a0b1...a0b1" })).toBeVisible();
});

test("type chips summarize the ledger and filter its list", async ({
  page,
}) => {
  await page.route(HORIZON, horizonHandler);
  await page.route(
    RPC,
    healthRoute(() => 64100000),
  );
  await page.route(INDEXER, (route) =>
    route.fulfill({
      json: { invocations: 12, contracts: 3, functions: 4, indexed: true },
    }),
  );

  await page.goto("/ledger/64000000");
  await expect(page.getByText("harvest(")).toBeVisible();

  // each chip carries its count; picking one narrows the list to its type
  await page.getByRole("button", { name: "Payment 1" }).click();
  await expect(page.getByText("harvest(")).not.toBeVisible();
  await expect(page.getByText("sent 5 XLM")).toBeVisible();

  // picking the active chip again lifts the filter
  await page.getByRole("button", { name: "Payment 1" }).click();
  await expect(page.getByText("harvest(")).toBeVisible();

  // the failed chip is its own dimension, cutting across the types
  await page.getByRole("button", { name: "failed 1" }).click();
  await expect(page.getByText("harvest(")).not.toBeVisible();
  await expect(page.getByText("sent 5 XLM")).toBeVisible();
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
  await expect(page.getByText("64,000,000", { exact: true })).toBeVisible();
});

test("a ledger before recorded history explains itself", async ({ page }) => {
  const BEFORE_HISTORY = {
    status: 410,
    json: {
      type: "https://stellar.org/horizon-errors/before_history",
      title: "Data Requested Is Before Recorded History",
      status: 410,
    },
  };
  await page.route(HORIZON, (route) => route.fulfill(BEFORE_HISTORY));
  await page.route(HORIZON_FALLBACK, (route) => route.fulfill(BEFORE_HISTORY));
  await page.route(
    RPC,
    healthRoute(() => 64000000),
  );

  await page.goto("/ledger/50457424");

  await expect(page.getByText(/older than the data provider/)).toBeVisible();
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
    const url = new URL(route.request().url());
    if (url.pathname !== "/ledgers/64000001") {
      return route.fulfill(NOT_FOUND);
    }
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
  await expect(page.getByText("+30")).toBeVisible({ timeout: 15000 });
});
