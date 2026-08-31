import { expect, test } from "@playwright/test";
import { blockLiveHosts, HORIZON_PROVIDERS, INDEXER } from "./hermetic";

const ISSUER = "GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S";
const CONTRACT = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const LONELY = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";

function assetStat() {
  return {
    _embedded: {
      records: [
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: ISSUER,
          contract_id: CONTRACT,
          num_claimable_balances: 955,
          num_liquidity_pools: 880,
          num_contracts: 54481,
          accounts: { authorized: 2368269 },
          balances: { authorized: "286497628.6977064" },
          claimable_balances_amount: "22457.8020574",
          liquidity_pools_amount: "2513708.2307253",
          contracts_amount: "37903151.4987654",
          flags: { auth_required: false, auth_revocable: true },
        },
      ],
    },
  };
}

function meta() {
  return {
    name: "USD Coin",
    description: "A fully collateralized US dollar stablecoin.",
    domain: "centre.io",
    icon: true,
  };
}

test.beforeEach(async ({ page }) => {
  await blockLiveHosts(page);
  for (const pattern of HORIZON_PROVIDERS) {
    await page.route(pattern, (route) => {
      const url = route.request().url();
      if (url.includes("/assets?") && url.includes(ISSUER)) {
        return route.fulfill({ json: assetStat() });
      }
      if (url.includes("/assets?")) {
        return route.fulfill({ json: { _embedded: { records: [] } } });
      }
      if (url.includes("/ledgers?")) {
        return route.fulfill({
          json: {
            _embedded: {
              records: [
                {
                  sequence: 64000123,
                  hash: "ab".repeat(32),
                  closed_at: "2026-08-30T12:00:00Z",
                  successful_transaction_count: 100,
                  failed_transaction_count: 1,
                  operation_count: 500,
                  protocol_version: 23,
                  paging_token: "1",
                  total_coins: "105443902087.3472865",
                },
              ],
            },
          },
        });
      }
      return route.fulfill({ status: 404, json: { status: 404 } });
    });
  }
  await page.route(INDEXER, (route) => {
    if (route.request().url().endsWith(`/assets/USDC/${ISSUER}/meta`)) {
      return route.fulfill({ json: meta() });
    }
    return route.fulfill({ status: 404, json: { error: "no meta" } });
  });
});

test("an issued asset shows its identity and ledger standing", async ({
  page,
}) => {
  await page.goto(`/asset/USDC-${ISSUER}`);

  await expect(
    page.getByRole("heading", { name: "USDC", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("USD Coin")).toBeVisible();
  await expect(page.getByRole("link", { name: "centre.io" })).toHaveAttribute(
    "href",
    "https://centre.io",
  );
  await expect(page.getByText("A fully collateralized")).toBeVisible();
  await expect(page.getByText("2,368,269")).toBeVisible();
  await expect(page.getByText("286,497,628.6977")).toBeVisible();
  await expect(page.getByText("across 880 pools")).toBeVisible();
  await expect(page.getByRole("link", { name: CONTRACT })).toHaveAttribute(
    "href",
    `/contract/${CONTRACT}`,
  );
  await expect(page.getByText("revocable", { exact: true })).toBeVisible();
});

test("an asset nobody holds says so instead of showing numbers", async ({
  page,
}) => {
  await page.goto(`/asset/NOPE-${LONELY}`);

  await expect(
    page.getByText("No account holds a trustline to this asset"),
  ).toBeVisible();
});

test("the native asset page knows itself without any issuer", async ({
  page,
}) => {
  await page.goto("/asset/XLM");

  await expect(page.getByText("Stellar Lumens")).toBeVisible();
  await expect(page.getByText("105,443,902,087.34728 XLM")).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "stellar.org" }),
  ).toHaveAttribute("href", "https://stellar.org");
});

test("a malformed asset reference is called out, not looked up", async ({
  page,
}) => {
  await page.goto("/asset/not-an-asset");

  await expect(page.getByText("Not a valid asset")).toBeVisible();
});
