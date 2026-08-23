import { expect, test, type Route } from "@playwright/test";

const G1 = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";

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
  if (url.includes("/transactions")) {
    txPolls += 1;
    const records =
      txPolls === 1
        ? [
            tx("aaaa".repeat(16), "tx2", true),
            tx("dddd".repeat(16), "tx1", false),
          ]
        : [
            tx("beef".repeat(16), "tx3", true),
            tx("aaaa".repeat(16), "tx2", true),
            tx("dddd".repeat(16), "tx1", false),
          ];
    return route.fulfill({ json: { _embedded: { records } } });
  }
  return route.abort();
}

let txPolls = 0;

test.beforeEach(async ({ page }) => {
  txPolls = 0;
  await page.route("https://**", (route) => route.abort());
  await page.route("https://horizon.stellar.org/**", horizonHandler);
});

test("home shows seeded and streamed ledgers and transactions", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "64,000,000" })).toBeVisible();
  await expect(page.getByRole("link", { name: "64,000,002" })).toBeVisible();
  await expect(page.getByText("aaaa...aaaa")).toBeVisible();
  await expect(page.getByText("beef...beef")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("failed").first()).toBeAttached();
  await expect(page.getByText("live").first()).toBeVisible();
});

test("streamed head updates the latest-ledger stat", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByText("Latest ledger").locator("..").getByText("64,000,002"),
  ).toBeVisible();
});
