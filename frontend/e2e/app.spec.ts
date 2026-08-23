import { expect, test } from "@playwright/test";

const RPC_PROVIDERS = [
  "https://mainnet.sorobanrpc.com/**",
  "https://rpc.ankr.com/**",
  "https://soroban-rpc.mainnet.stellar.gateway.fm/**",
  "https://stellar.api.onfinality.io/**",
];

function healthBody(latestLedger: number) {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      status: "healthy",
      latestLedger,
      latestLedgerCloseTime: 1756000000,
      oldestLedger: latestLedger - 120960,
      oldestLedgerCloseTime: 1755000000,
      ledgerRetentionWindow: 120960,
    },
  };
}

test("shows the live ledger height from the first provider", async ({
  page,
}) => {
  await page.route(RPC_PROVIDERS[0], (route) =>
    route.fulfill({ json: healthBody(64123456) }),
  );

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Soroscan" })).toBeVisible();
  await expect(page.getByText("ledger 64,123,456")).toBeVisible();
});

test("fails over to the next provider when the first is down", async ({
  page,
}) => {
  await page.route(RPC_PROVIDERS[0], (route) => route.abort());
  await page.route(RPC_PROVIDERS[1], (route) =>
    route.fulfill({ json: healthBody(64999999) }),
  );

  await page.goto("/");

  await expect(page.getByText("ledger 64,999,999")).toBeVisible();
});

test("degrades to network unreachable when every provider is down", async ({
  page,
}) => {
  for (const pattern of RPC_PROVIDERS) {
    await page.route(pattern, (route) => route.abort());
  }

  await page.goto("/");

  await expect(page.getByText("network unreachable")).toBeVisible({
    timeout: 20000,
  });
});
