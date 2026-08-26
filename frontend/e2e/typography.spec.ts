import { expect, test, type Route } from "@playwright/test";
import { blockLiveHosts, HORIZON_PROVIDERS, RPC_PROVIDERS } from "./hermetic";

const G1 = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const C1 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const HASH = "beef".repeat(16);

// the app runs on one text size; every other size on the page has to be a
// heading or the chip layer, named here on purpose so a stray text-[13px]
// or a reintroduced text-xs on body copy fails the build
const BODY_PX = 14;
const BODY_LINE_HEIGHT_PX = 21;
const ALLOWED_PX = new Set([
  BODY_PX,
  12, // chips, badges, keycaps, type tags
  18, // section heading
  20, // header wordmark, stat readouts
  30, // page heading
  48, // home hero wordmark
]);

const TX_DETAIL = {
  hash: HASH,
  paging_token: "1",
  successful: true,
  source_account: G1,
  source_account_sequence: "203069091936010245",
  created_at: "2026-08-24T10:00:00Z",
  fee_charged: "200",
  max_fee: "1000",
  memo_type: "none",
  operation_count: 1,
  ledger: 64000123,
  envelope_xdr: "AAAAAgAAAABENVELOPE=",
  result_xdr: "AAAAAAAAAMgAAAAA=",
  fee_meta_xdr: "AAAAAgAAAAM=",
  signatures: ["c2ln"],
};

const LEDGER = {
  sequence: 64000123,
  hash: "a".repeat(64),
  closed_at: "2026-08-24T10:00:00Z",
  successful_transaction_count: 12,
  failed_transaction_count: 1,
  operation_count: 30,
  protocol_version: 23,
  paging_token: "1",
};

const ACCOUNT = {
  id: G1,
  account_id: G1,
  sequence: "203069091936010245",
  subentry_count: 2,
  last_modified_ledger: 64000123,
  home_domain: "example.com",
  balances: [
    { balance: "100.0000000", asset_type: "native" },
    {
      balance: "250.0000000",
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: G1,
      limit: "1000.0000000",
    },
  ],
  signers: [{ key: G1, weight: 1, type: "ed25519_public_key" }],
  thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
  flags: {
    auth_required: true,
    auth_revocable: false,
    auth_immutable: false,
    auth_clawback_enabled: false,
  },
  data: { greeting: "aGVsbG8=" },
};

function horizonHandler(route: Route) {
  const url = route.request().url();
  // the account page is only worth measuring with a body to render
  if (url.includes(`/accounts/${G1}/`)) {
    return route.fulfill({ json: { _embedded: { records: [] } } });
  }
  if (url.includes(`/accounts/${G1}`)) {
    return route.fulfill({ json: ACCOUNT });
  }
  if (url.includes(`/transactions/${HASH}/`)) {
    return route.fulfill({ json: { _embedded: { records: [] } } });
  }
  if (url.includes(`/transactions/${HASH}`)) {
    return route.fulfill({ json: TX_DETAIL });
  }
  if (url.includes("/ledgers/")) {
    return route.fulfill({ json: LEDGER });
  }
  return route.fulfill({ json: { _embedded: { records: [] } } });
}

function rpcHandler(route: Route) {
  return route.fulfill({
    json: {
      jsonrpc: "2.0",
      id: 1,
      result: {
        status: "healthy",
        latestLedger: 64000200,
        latestLedgerCloseTime: "1756000000",
        oldestLedger: 63000000,
        oldestLedgerCloseTime: "1",
        ledgerRetentionWindow: 120960,
      },
    },
  });
}

test.beforeEach(async ({ page }) => {
  await blockLiveHosts(page);
  for (const pattern of HORIZON_PROVIDERS) {
    await page.route(pattern, horizonHandler);
  }
  for (const pattern of RPC_PROVIDERS) {
    await page.route(pattern, rpcHandler);
  }
});

const ROUTES: Array<[string, string]> = [
  ["home", "/"],
  ["transaction", `/tx/${HASH}`],
  ["account", `/account/${G1}`],
  ["contract", `/contract/${C1}`],
  ["ledger", "/ledger/64000123"],
  ["not found", "/no-such-page"],
];

for (const [name, path] of ROUTES) {
  test(`${name} renders text on the locked type scale`, async ({ page }) => {
    await page.goto(path);
    await page.waitForTimeout(600);

    const offenders = await page.evaluate(() => {
      const found: Array<{ size: number; line: number; text: string }> = [];
      for (const element of Array.from(document.querySelectorAll("body *"))) {
        const own = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim();
        if (own === "") {
          continue;
        }
        if (element.closest(".sr-only") !== null) {
          continue; // announced to screen readers, never painted
        }
        if (element.closest('[aria-hidden="true"]') !== null) {
          continue; // decoration: a glyph drawn to fit its own box
        }
        const box = (element as HTMLElement).getBoundingClientRect();
        if (box.width === 0 || box.height === 0) {
          continue;
        }
        const style = getComputedStyle(element);
        found.push({
          size: parseFloat(style.fontSize),
          line: parseFloat(style.lineHeight),
          text: own.slice(0, 40),
        });
      }
      return found;
    });

    expect(offenders.length).toBeGreaterThan(0);

    const offScale = offenders.filter((item) => !ALLOWED_PX.has(item.size));
    expect(offScale, `off-scale text: ${JSON.stringify(offScale)}`).toEqual([]);

    // body text also has to share one rhythm, so a stray leading- utility
    // cannot quietly reintroduce a second line-height
    const offRhythm = offenders.filter(
      (item) => item.size === BODY_PX && item.line !== BODY_LINE_HEIGHT_PX,
    );
    expect(
      offRhythm,
      `body text off the shared line-height: ${JSON.stringify(offRhythm)}`,
    ).toEqual([]);
  });
}
