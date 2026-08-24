import { expect, test, type Route } from "@playwright/test";
import { blockLiveHosts, RPC_PROVIDERS } from "./hermetic";

function rpcRoute(latestLedger: number) {
  return (route: Route) => {
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
          latestLedger,
          latestLedgerCloseTime: 1756000000,
          oldestLedger: latestLedger - 120960,
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

test("shows network health from the first provider", async ({ page }) => {
  await page.route(RPC_PROVIDERS[0], rpcRoute(64123456));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "soroscan" })).toBeVisible();
  await expect(page.getByText("network healthy")).toBeVisible();
});

test("fails over to the next provider when the first is down", async ({
  page,
}) => {
  await page.route(RPC_PROVIDERS[0], (route) => route.abort());
  await page.route(RPC_PROVIDERS[1], rpcRoute(64999999));

  await page.goto("/");

  await expect(page.getByText("network healthy")).toBeVisible();
});

test("degrades to network unreachable when every provider is down", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByText("network unreachable")).toBeVisible({
    timeout: 20000,
  });
});
