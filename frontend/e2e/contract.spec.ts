import { expect, test, type Route } from "@playwright/test";
import * as xdr from "@stellar/stellar-sdk/xdr";
import { StrKey } from "@stellar/stellar-sdk/base";
import { blockLiveHosts, HORIZON_PROVIDERS, RPC_PROVIDERS } from "./hermetic";

const WASM_CONTRACT =
  "CBGSBKYMYO6OMGHQXXNOBRGVUDFUDVC2XLC3SXON5R2SNXILR7XCKKY3";
const SAC_CONTRACT = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
// a well-formed contract strkey (StrKey.encodeContract of 32 x 0xab) that
// simply has no ledger entry behind it, standing in for "never deployed
// or since archived" rather than "malformed address"
const MISSING_CONTRACT =
  "CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW";
const WASM_HASH_HEX =
  "70fe44694c9fe6b0abc69a6da4858fc2aaba04fa10492a466a1d426d04ca8560";

// real ledger entries captured from mainnet.sorobanrpc.com getLedgerEntries,
// same fixtures the unit tests use: real bytes rather than hand-built XDR,
// which cannot accidentally agree with the app's own decoder
const WASM_INSTANCE_XDR =
  "AAAABgAAAAAAAAABTSCrDMO85hjwvdrgxNWgy0HUWrrFuV3N7HUm3QuP7iUAAAAUAAAAAQAAABMAAAAAcP5EaUyf5rCrxpptpIWPwqq6BPoQSSpGah1CbQTKhWAAAAABAAAAAQAAAA8AAAAERkFSTQAAABIAAAAB1/5EvQrxHWArEJHy9KH03yEtRE0DIeoyrbPMHLurCgQ=";
const WASM_INSTANCE_LIVE_UNTIL = 67212555;
const WASM_INSTANCE_LAST_MODIFIED = 56360642;
const WASM_CODE_XDR =
  "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";
const WASM_CODE_LAST_MODIFIED = 56360626;

const SAC_INSTANCE_XDR =
  "AAAABgAAAAAAAAABJbT82FmuwvpjSEOMSJs8PBDJi20hvk/TyzDLaJU++XcAAAAUAAAAAQAAABMAAAABAAAAAQAAAAIAAAAPAAAACE1FVEFEQVRBAAAAEQAAAAEAAAADAAAADwAAAAdkZWNpbWFsAAAAAAMAAAAHAAAADwAAAARuYW1lAAAADgAAAAZuYXRpdmUAAAAAAA8AAAAGc3ltYm9sAAAAAAAOAAAABm5hdGl2ZQAAAAAAEAAAAAEAAAABAAAADwAAAAlBc3NldEluZm8AAAAAAAAQAAAAAQAAAAEAAAAPAAAABk5hdGl2ZQAA";
const SAC_INSTANCE_LIVE_UNTIL = 64261245;
const SAC_INSTANCE_LAST_MODIFIED = 50463386;

function instanceKeyOf(contract: string): string {
  const idBytes = StrKey.decodeContract(contract);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: xdr.ScAddress.scAddressTypeContract(
        new xdr.ContractId(idBytes),
      ),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  ).toXdr("base64");
}

function codeKeyOf(hashHex: string): string {
  const bytes = new Uint8Array(hashHex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = parseInt(hashHex.slice(index * 2, index * 2 + 2), 16);
  }
  return xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({ hash: bytes }),
  ).toXdr("base64");
}

const WASM_INSTANCE_KEY = instanceKeyOf(WASM_CONTRACT);
const SAC_INSTANCE_KEY = instanceKeyOf(SAC_CONTRACT);
const WASM_CODE_KEY = codeKeyOf(WASM_HASH_HEX);

// a call this contract made, discovered the only way possible: an event it
// raised itself. The account address and function name do not matter to
// the test, only that HistoryRow has enough of a real operation to render
const INVOCATION_HASH = "aabb".repeat(16);
const CALLER = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const WASM_CONTRACT_SCVAL =
  "AAAAEgAAAAFNIKsMw7zmGPC92uDE1aDLQdRausW5Xc3sdSbdC4/uJQ==";
const HARVEST_SCVAL = "AAAADwAAAAdoYXJ2ZXN0AA=="; // symbol "harvest"
const U32_SCVAL = "AAAAAwACuHE="; // u32 178289

const ENTRY_BY_KEY: Record<
  string,
  { xdr: string; lastModifiedLedgerSeq: number; liveUntilLedgerSeq?: number }
> = {
  [WASM_INSTANCE_KEY]: {
    xdr: WASM_INSTANCE_XDR,
    lastModifiedLedgerSeq: WASM_INSTANCE_LAST_MODIFIED,
    liveUntilLedgerSeq: WASM_INSTANCE_LIVE_UNTIL,
  },
  [WASM_CODE_KEY]: {
    xdr: WASM_CODE_XDR,
    lastModifiedLedgerSeq: WASM_CODE_LAST_MODIFIED,
  },
  [SAC_INSTANCE_KEY]: {
    xdr: SAC_INSTANCE_XDR,
    lastModifiedLedgerSeq: SAC_INSTANCE_LAST_MODIFIED,
    liveUntilLedgerSeq: SAC_INSTANCE_LIVE_UNTIL,
  },
  // MISSING_CONTRACT deliberately has no entry: getLedgerEntries answers
  // with an empty array, a valid response, not a provider failure
};

// only WASM_CONTRACT ever raised an event in this fixture; every other
// contract answers with an empty page, same as one that never emits
const EVENT_CONTRACTS = new Set([WASM_CONTRACT]);

// this contract's one event sits well outside the recent-day tier, and
// past a single scan hop within the full-window tier: proves both that a
// real provider's bounded per-call scan is fully drained via its cursor,
// and that the fallback tier reaches older activity the first tier misses
const LATE_EVENT_CONTRACT =
  "CDG43TONZXG43TONZXG43TONZXG43TONZXG43TONZXG43TONZXG42EVB";
const LATE_EVENT_HASH = "bbcc".repeat(16);
const LATE_EVENT_VISIBLE_FROM = 50_000;
const MOCK_SCAN_HOP = 10_000; // mirrors a real provider's bounded per-call scan

function rpcHandler(route: Route) {
  const request = JSON.parse(route.request().postData() ?? "{}") as {
    id?: number;
    method?: string;
    params?: {
      keys?: string[];
      startLedger?: number;
      pagination?: { cursor?: string };
      filters?: Array<{ contractIds?: string[] }>;
    };
  };
  if (request.method === "getHealth") {
    return route.fulfill({
      json: {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          status: "healthy",
          latestLedger: 100_000,
          latestLedgerCloseTime: "1000000",
          oldestLedger: 1,
          oldestLedgerCloseTime: "1",
          ledgerRetentionWindow: 120_960,
        },
      },
    });
  }
  if (request.method === "getEvents") {
    const contractId = request.params?.filters?.[0]?.contractIds?.[0];
    if (contractId === LATE_EVENT_CONTRACT) {
      const startLedger = request.params?.startLedger;
      const cursorIn = request.params?.pagination?.cursor;
      const position =
        typeof startLedger === "number"
          ? startLedger
          : Number((cursorIn ?? "pos:0").slice(4));
      const nextPosition = Math.min(position + MOCK_SCAN_HOP, 100_000);
      const hasEvents =
        position <= LATE_EVENT_VISIBLE_FROM &&
        nextPosition >= LATE_EVENT_VISIBLE_FROM;
      return route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            events: hasEvents
              ? [
                  {
                    ledger: 50_000,
                    ledgerClosedAt: "2026-08-20T10:00:00Z",
                    txHash: LATE_EVENT_HASH,
                    topic: [HARVEST_SCVAL],
                    value: HARVEST_SCVAL,
                  },
                ]
              : [],
            cursor: `pos:${nextPosition}`,
            latestLedger: 100_000,
            oldestLedger: 1,
          },
        },
      });
    }
    const hasEvents =
      contractId !== undefined && EVENT_CONTRACTS.has(contractId);
    return route.fulfill({
      json: {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          events: hasEvents
            ? [
                {
                  ledger: 99_000,
                  ledgerClosedAt: "2026-08-24T10:00:00Z",
                  txHash: INVOCATION_HASH,
                  topic: [HARVEST_SCVAL],
                  value: HARVEST_SCVAL,
                },
              ]
            : [],
          latestLedger: 100_000,
          oldestLedger: 1,
        },
      },
    });
  }
  if (request.method !== "getLedgerEntries") {
    return route.fulfill({
      json: { jsonrpc: "2.0", id: request.id, result: { status: "NOT_FOUND" } },
    });
  }
  const key = request.params?.keys?.[0] ?? "";
  const entry = ENTRY_BY_KEY[key];
  return route.fulfill({
    json: {
      jsonrpc: "2.0",
      id: request.id,
      result: { entries: entry === undefined ? [] : [entry], latestLedger: 1 },
    },
  });
}

function horizonHandler(route: Route) {
  const url = route.request().url();
  if (
    url.includes(`/transactions/${INVOCATION_HASH}/operations`) ||
    url.includes(`/transactions/${LATE_EVENT_HASH}/operations`)
  ) {
    const hash = url.includes(LATE_EVENT_HASH)
      ? LATE_EVENT_HASH
      : INVOCATION_HASH;
    return route.fulfill({
      json: {
        _embedded: {
          records: [
            {
              id: "invoke",
              paging_token: "1",
              transaction_hash: hash,
              type: "invoke_host_function",
              source_account: CALLER,
              created_at: "2026-08-24T10:00:00Z",
              transaction: { fee_charged: "189", successful: true },
              address: "",
              function: "HostFunctionTypeHostFunctionTypeInvokeContract",
              parameters: [
                { type: "Address", value: WASM_CONTRACT_SCVAL },
                { type: "Sym", value: HARVEST_SCVAL },
                { type: "U32", value: U32_SCVAL },
              ],
            },
          ],
        },
      },
    });
  }
  return route.abort();
}

test.beforeEach(async ({ page }) => {
  await blockLiveHosts(page);
  for (const pattern of RPC_PROVIDERS) {
    await page.route(pattern, rpcHandler);
  }
  for (const pattern of HORIZON_PROVIDERS) {
    await page.route(pattern, horizonHandler);
  }
});

test("a wasm contract shows its executable, storage, and interface", async ({
  page,
}) => {
  await page.goto(`/contract/${WASM_CONTRACT}`);

  await expect(page.getByRole("heading", { name: "Contract" })).toBeVisible();
  await expect(page.getByText("WebAssembly")).toBeVisible();
  await expect(page.getByText("70fe4469...04ca8560")).toBeVisible();
  await expect(page.getByText("1 entry")).toBeVisible();
  await expect(page.getByText("67,212,555")).toBeVisible();
  await expect(page.getByText("56,360,642")).toBeVisible();
  // the code entry loads lazily behind the instance, not blocking it
  await expect(page.getByText(/^\d[\d,]* B$/)).toBeVisible();

  await page.getByRole("tab", { name: "Interface" }).click();
  await expect(page.getByText("harvest(")).toBeVisible();
  await expect(
    page.getByText("farmer: Address, pails: Vec<u32>"),
  ).toBeVisible();
  await expect(page.getByText("-> Vec<i128>")).toBeVisible();
  // the function's own rustdoc comment, read straight out of the spec
  await expect(
    page.getByText("Harvest multiple pails available for your KALE farmer."),
  ).toBeVisible();
  await expect(page.getByText("# Arguments")).toBeVisible();
  // a function with no doc comment gets no comment block, not an empty one
  await expect(page.getByText("fn __constructor(farm: Address)")).toBeVisible();
  // the errors a call can raise, each with its own doc and value
  await expect(page.getByText("#[contracterror]")).toBeVisible();
  await expect(page.getByText("enum Error")).toBeVisible();
  await expect(page.getByText("NoPailsProvided = 1,")).toBeVisible();
  await expect(page.getByText("No pails provided in invocation")).toBeVisible();

  await page.getByRole("tab", { name: "Storage" }).click();
  await expect(page.getByText(/own instance storage/)).toBeVisible();
  await expect(page.getByText("FARM")).toBeVisible();
});

test("a stellar asset contract explains itself instead of showing an empty spec", async ({
  page,
}) => {
  await page.goto(`/contract/${SAC_CONTRACT}?tab=interface`);

  await expect(page.getByText("SEP-41")).toBeVisible();

  await page.goto(`/contract/${SAC_CONTRACT}`);
  await expect(page.getByText("Stellar Asset Contract")).toBeVisible();
  // no wasm, so no code-size row and no wasm hash to show
  await expect(page.getByText("Code size")).not.toBeVisible();
});

test("a contract with no live entry says so without guessing why", async ({
  page,
}) => {
  await page.goto(`/contract/${MISSING_CONTRACT}`);

  await expect(page.getByText("never have been deployed")).toBeVisible();
  await expect(page.getByText("expired")).toBeVisible();

  await page.getByRole("tab", { name: "Interface" }).click();
  await expect(page.getByText("no live instance")).toBeVisible();

  await page.getByRole("tab", { name: "Storage" }).click();
  await expect(page.getByText("no live instance")).toBeVisible();
});

test("tabs are shareable through the url", async ({ page }) => {
  await page.goto(`/contract/${WASM_CONTRACT}?tab=storage`);
  await expect(page.getByText("FARM")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Storage" })).toHaveAttribute(
    "data-state",
    "active",
  );
});

test("an invalid address is rejected before any request goes out", async ({
  page,
}) => {
  await page.goto("/contract/not-a-real-address");
  await expect(page.getByText("contract address")).toBeVisible();
});

test("invocations shows a transaction where the contract raised its own event", async ({
  page,
}) => {
  await page.goto(`/contract/${WASM_CONTRACT}?tab=invocations`);

  await expect(page.getByRole("heading", { name: "Contract" })).toBeVisible();
  // the retention window is read from getHealth, not a hardcoded claim
  await expect(page.getByText(/about 6 days/)).toBeVisible();
  // the row reads the same way an account history row does, because it
  // is the exact same component
  await expect(page.getByText("harvest(")).toBeVisible();
  await expect(page.getByText("178289")).toBeVisible();

  const row = page.getByRole("row").nth(1);
  await row.locator("summary").click({ position: { x: 6, y: 10 } });
  await expect(
    row.getByRole("link", { name: /Open transaction/ }),
  ).toBeVisible();
});

test("invocations explains an empty result instead of implying nothing happened", async ({
  page,
}) => {
  await page.goto(`/contract/${SAC_CONTRACT}?tab=invocations`);

  await expect(page.getByText("does not raise its own events")).toBeVisible();
  // neither of the two things an empty page could mean is claimed as fact
  await expect(page.getByText("contract was quiet")).toBeVisible();
});

test("invocations widens the scan past the first attempt to find older activity", async ({
  page,
}) => {
  await page.goto(`/contract/${LATE_EVENT_CONTRACT}?tab=invocations`);

  await expect(page.getByRole("heading", { name: "Contract" })).toBeVisible();
  // the event only exists outside the first, narrow lookback: finding it
  // proves the retry actually widened rather than giving up early
  await expect(page.getByText("No such transactions")).not.toBeVisible();
  await expect(page.getByRole("row").nth(1)).toBeVisible();
});
