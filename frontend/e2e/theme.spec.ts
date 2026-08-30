import { expect, test, type Route } from "@playwright/test";
import { blockLiveHosts, RPC_PROVIDERS } from "./hermetic";

function rpcRoute(route: Route) {
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
        latestLedger: 64123456,
        latestLedgerCloseTime: 1756000000,
        oldestLedger: 64002496,
        oldestLedgerCloseTime: 1755000000,
        ledgerRetentionWindow: 120960,
      },
    },
  });
}

test.beforeEach(async ({ page }) => {
  await blockLiveHosts(page);
  await page.route(RPC_PROVIDERS[0], rpcRoute);
});

test("a first visit follows the system preference", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  await blockLiveHosts(page);
  await page.route(RPC_PROVIDERS[0], rpcRoute);

  await page.goto("/");

  await expect(page.locator("html")).toHaveClass(/dark/);
  await context.close();
});

test("the toggle switches the theme and the choice survives a reload", async ({
  page,
}) => {
  await page.goto("/");
  // playwright contexts prefer light, so the toggle offers dark first
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  await page.getByLabel("Switch to the dark theme").click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);

  // an explicit choice outlives the system preference on later visits
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.getByLabel("Switch to the light theme").click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});
