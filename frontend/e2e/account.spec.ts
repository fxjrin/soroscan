import { expect, test, type Page, type Route } from "@playwright/test";
import {
  blockLiveHosts,
  HORIZON_PROVIDERS,
  INDEXER,
  RPC_PROVIDERS,
} from "./hermetic";

const G = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const ISSUER = "GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S";
const MISSING = "GAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCF6M";
// one ledger account plus a subaccount id; Horizon rejects this form, so
// the page has to look up the account inside it
const MUXED =
  "MADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOAAAAAAAAAAAAG4HM";
const MALFORMED = "GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE";

const CONTRACT_SCVAL =
  "AAAAEgAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQ==";
const HARVEST_SCVAL = "AAAADwAAAAdoYXJ2ZXN0AA=="; // symbol "harvest"
const U32_SCVAL = "AAAAAwACuds="; // u32 178651
// TransactionMetaV3 with the diagnostic events for harvest(178651)
const RESULT_META_XDR =
  "AAAAAwAAAAAAAAAAAAAAAQAAAAMAAAACAAAABgAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQAAAA8AAAAEUGFpbAAAAAAAAAABAAAAAQAAAAkqN3ZPeQMnvPzkeOjhHEPM+0L39uNfeL07eE/5TOaVDQPSadoAAAAAAAAAAAAAAAEAAAAGAAAAAAAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQAAAA8AAAAEUGFpbAAAAAAAAAADAAK52wAAAAAAAAAAAAAAAQAAAAEAAAAAAAAAAAAAtiEAAAAAAAAl/wAAAAAAAAAAAAAAAAAAAAoAAAAAAAAAAAAAAAAAeDgyAAAADgAAAAEAAAAAAAAAAAAAAAIAAAAAAAAAAwAAAA8AAAAHZm5fY2FsbAAAAAANAAAAINeSi3LCcDzP6vfrn/TvTVBKVai5efybRQ6iyEK00c5hAAAADwAAAAdoYXJ2ZXN0AAAAABAAAAABAAAAAQAAAAMAArnbAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAADAAAADwAAAAdmbl9jYWxsAAAAAA0AAAAg15KLcsJwPM/q9+uf9O9NUEpVqLl5/JtFDqLIQrTRzmEAAAAPAAAABG1pbnQAAAAQAAAAAQAAAAEAAAADAAK52gAAAAEAAAAAAAAAAdeSi3LCcDzP6vfrn/TvTVBKVai5efybRQ6iyEK00c5hAAAAAQAAAAAAAAABAAAADwAAAARtaW50AAAACgAAAAAAAAAAAAAAAACWcwgAAAABAAAAAAAAAAAAAAACAAAAAAAAAAIAAAAPAAAACWZuX3JldHVybgAAAAAAAA8AAAAEbWludAAAAAoAAAAAAAAAAAAAAAAAlnMIAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAlmbl9yZXR1cm4AAAAAAAAPAAAAB2hhcnZlc3QAAAAACgAAAAAAAAAAAAAAAAB4ODIAAAABAAAAAAAAAAAAAAACAAAAAAAAAAIAAAAPAAAADGNvcmVfbWV0cmljcwAAAA8AAAAKcmVhZF9lbnRyeQAAAAAABQAAAAAAAAAYAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAxjb3JlX21ldHJpY3MAAAAPAAAAC3dyaXRlX2VudHJ5AAAAAAUAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAIAAAAAAAAAAgAAAA8AAAAMY29yZV9tZXRyaWNzAAAADwAAABBsZWRnZXJfcmVhZF9ieXRlAAAABQAAAAAAAAB0AAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAxjb3JlX21ldHJpY3MAAAAPAAAAEWxlZGdlcl93cml0ZV9ieXRlAAAAAAAABQAAAAAAAAB0AAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAxjb3JlX21ldHJpY3MAAAAPAAAACmVtaXRfZXZlbnQAAAAAAAUAAAAAAAAACQAAAAEAAAAAAAAAAAAAAAIAAAAAAAAAAgAAAA8AAAAMY29yZV9tZXRyaWNzAAAADwAAAA9lbWl0X2V2ZW50X2J5dGUAAAAABQAAAAAAAAfIAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAxjb3JlX21ldHJpY3MAAAAPAAAACGNwdV9pbnNuAAAABQAAAAAAnMcAAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAxjb3JlX21ldHJpY3MAAAAPAAAACG1lbV9ieXRlAAAABQAAAAAAyYkRAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAxjb3JlX21ldHJpY3MAAAAPAAAAEWludm9rZV90aW1lX25zZWNzAAAAAAAABQAAAAAAFC/4";
const CONTRACT_HASH = "cafe".repeat(16);
// a call that reaches no other contract and raises no event: the summary
// row already says everything the trace would, so the tree has nothing left
const LEAF_HASH = "dada".repeat(16);
const PLANT_SCVAL = "AAAADwAAAAVwbGFudAAAAA=="; // symbol "plant"
const ZERO_I128_SCVAL = "AAAACgAAAAAAAAAAAAAAAAAAAAA="; // i128 0
// TransactionMetaV3 with only the top-level fn_call/fn_return pair
const LEAF_META_XDR =
  "AAAAAwAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAIAAAABAAAAAAAAAAAAAAACAAAAAAAAAAMAAAAPAAAAB2ZuX2NhbGwAAAAADQAAACDX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX1wAAAA8AAAAFcGxhbnQAAAAAAAAQAAAAAQAAAAIAAAASAAAAAdeSi3LCcDzP6vfrn/TvTVBKVai5efybRQ6iyEK00c5hAAAACgAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAACAAAAAAAAAAIAAAAPAAAACWZuX3JldHVybgAAAAAAAA8AAAAFcGxhbnQAAAAAAAAB";
// a leaf call that still wrote to storage: nothing for the tree to draw,
// but not nothing the call did
const LEAF_STORAGE_HASH = "beda".repeat(16);
// TransactionMetaV3 with the same plant() fn_call/fn_return pair, plus a
// temporary "Pail" entry created and its ttl extended
const LEAF_STORAGE_META_XDR =
  "AAAAAwAAAAAAAAAAAAAAAQAAAAIAAAAAA9LfZgAAAAYAAAAAAAAAAdfX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fXAAAAEAAAAAEAAAADAAAADwAAAARQYWlsAAAAEgAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQAAAAMAArvxAAAAAAAAABEAAAABAAAAAQAAAA8AAAAFc3Rha2UAAAAAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABA9LfZgAAAAkiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIgPS32cAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAEAAAACAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAADAAAADwAAAAdmbl9jYWxsAAAAAA0AAAAg19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX19cAAAAPAAAABXBsYW50AAAAAAAAEAAAAAEAAAACAAAAEgAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQAAAAoAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAlmbl9yZXR1cm4AAAAAAAAPAAAABXBsYW50AAAAAAAAAQ==";
// a call with real sub-calls AND storage changes, so the tree and the
// storage steps both render in the same row, seam between them included
const NESTED_STORAGE_HASH = "feed".repeat(16);
// the harvest()/mint() diagnostic events from RESULT_META_XDR, plus five
// removed temporary entries and five ttl entries tacked onto the changes
const NESTED_STORAGE_META_XDR =
  "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";
// a transaction whose meta has aged out of RPC retention: the only trace
// left is the one rebuilt from the envelope's authorization entries
const AGED_HASH = "face".repeat(16);
const AGED_ENVELOPE =
  "AAAAAgAAAAAHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwAAAGQAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAAYAAAAAAAAAAEREREREREREREREREREREREREREREREREREREREREREQAAAAdoYXJ2ZXN0AAAAAAEAAAADAAK52wAAAAEAAAAAAAAAAAAAAAEREREREREREREREREREREREREREREREREREREREREREQAAAAdoYXJ2ZXN0AAAAAAEAAAADAAK52wAAAAEAAAAAAAAAARERERERERERERERERERERERERERERERERERERERERERAAAABG1pbnQAAAABAAAAAwACudsAAAAAAAAAAAAAAAA=";

function account() {
  return {
    id: G,
    account_id: G,
    sequence: "203069091936010245",
    subentry_count: 3,
    last_modified_ledger: 64000123,
    home_domain: "example.com",
    num_sponsoring: 0,
    num_sponsored: 0,
    balances: [
      {
        balance: "250.0000000",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: ISSUER,
        limit: "1000.0000000",
      },
      {
        balance: "100.0000000",
        asset_type: "native",
        selling_liabilities: "10.0000000",
      },
    ],
    signers: [
      { key: G, weight: 1, type: "ed25519_public_key" },
      { key: ISSUER, weight: 2, type: "ed25519_public_key" },
    ],
    thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
    flags: {
      auth_required: true,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: false,
    },
    data: { greeting: "aGVsbG8=" },
  };
}

// a full page of operations: a contract call first, then three that share
// one classic transaction, so both row shapes and the grouping are covered
function operations(cursor?: string) {
  const base = cursor === undefined ? 0 : 100;
  const aged = {
    id: "aged",
    paging_token: String(275000000000000000n + BigInt(base + 2000)),
    transaction_hash: AGED_HASH,
    type: "invoke_host_function",
    source_account: G,
    created_at: "2026-07-31T09:27:52Z",
    transaction: { fee_charged: "62499", successful: true },
    address: "",
    function: "HostFunctionTypeHostFunctionTypeInvokeContract",
    parameters: [
      { type: "Address", value: CONTRACT_SCVAL },
      { type: "Sym", value: HARVEST_SCVAL },
      { type: "U32", value: U32_SCVAL },
    ],
  };
  const invocation = {
    id: "invoke",
    paging_token: String(275000000000000000n + BigInt(base + 1000)),
    transaction_hash: CONTRACT_HASH,
    type: "invoke_host_function",
    source_account: G,
    created_at: "2026-08-24T10:00:00Z",
    transaction: { fee_charged: "100", successful: true },
    address: "",
    function: "HostFunctionTypeHostFunctionTypeInvokeContract",
    parameters: [
      { type: "Address", value: CONTRACT_SCVAL },
      { type: "Sym", value: HARVEST_SCVAL },
      { type: "U32", value: U32_SCVAL },
    ],
  };
  const payments = Array.from({ length: 18 }, (_, index) => ({
    id: String(base + index),
    paging_token: String(275000000000000000n + BigInt(base + index)),
    transaction_hash:
      index < 3
        ? "beef".repeat(16)
        : (base + index).toString(16).padStart(64, "c"),
    type: "payment",
    source_account: G,
    created_at: "2026-08-24T10:00:00Z",
    transaction: { fee_charged: "200", successful: true },
    from: G,
    to: ISSUER,
    amount: `${base + index + 1}.0000000`,
    asset_type: "native",
  }));
  return { _embedded: { records: [invocation, aged, ...payments] } };
}

// what one row opens into
function txOperations() {
  return {
    _embedded: {
      records: [
        {
          id: "1",
          paging_token: "1",
          transaction_hash: "beef".repeat(16),
          type: "create_account",
          source_account: G,
          account: ISSUER,
          to: ISSUER,
          starting_balance: "5.0000000",
          amount: "5.0000000",
        },
        {
          id: "2",
          paging_token: "2",
          transaction_hash: "beef".repeat(16),
          type: "payment",
          source_account: G,
          from: G,
          to: ISSUER,
          amount: "1.0000000",
          asset_type: "native",
        },
        {
          id: "3",
          paging_token: "3",
          transaction_hash: "beef".repeat(16),
          type: "change_trust",
          source_account: G,
          trustor: G,
          asset_code: "USDC",
          asset_issuer: ISSUER,
        },
      ],
    },
  };
}

function rpcHandler(route: Route) {
  const request = JSON.parse(route.request().postData() ?? "{}") as {
    id?: number;
    method?: string;
    params?: { hash?: string };
  };
  const metaByHash: Record<string, string> = {
    [CONTRACT_HASH]: RESULT_META_XDR,
    [LEAF_HASH]: LEAF_META_XDR,
    [LEAF_STORAGE_HASH]: LEAF_STORAGE_META_XDR,
    [NESTED_STORAGE_HASH]: NESTED_STORAGE_META_XDR,
  };
  const metaXdr = metaByHash[request.params?.hash ?? ""];
  return route.fulfill({
    json: {
      jsonrpc: "2.0",
      id: request.id,
      result:
        metaXdr === undefined
          ? { status: "NOT_FOUND" }
          : { status: "SUCCESS", resultMetaXdr: metaXdr },
    },
  });
}

// the effects Horizon keeps for good, including a contract balance that
// moved during the aged transaction
function txEffects() {
  return {
    _embedded: {
      records: [
        {
          id: "e1",
          type: "account_debited",
          account: G,
          amount: "5.9039710",
          asset_type: "native",
        },
        {
          id: "e2",
          type: "contract_credited",
          account: G,
          contract: "CAS5PJYZQ74Z7W3YO24J6MX47WG6UFY52Z4JESCAE5I4COZFPAN664B3",
          amount: "5.9039710",
          asset_type: "native",
        },
      ],
    },
  };
}

// two standing offers, one of them larger than a JS number holds
function offers() {
  return {
    _embedded: {
      records: [
        {
          id: "426903336",
          paging_token: "426903336",
          seller: G,
          selling: {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: ISSUER,
          },
          buying: { asset_type: "native" },
          amount: "912880747704.3888320",
          price: "0.1234567",
          last_modified_time: "2026-08-24T10:00:00Z",
        },
        {
          id: "426903337",
          paging_token: "426903337",
          seller: G,
          selling: { asset_type: "native" },
          buying: {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: ISSUER,
          },
          amount: "100.0000000",
          price: "8.1000000",
          last_modified_time: "2026-08-24T10:00:00Z",
        },
      ],
    },
  };
}

function horizonHandler(route: Route) {
  const url = route.request().url();
  if (url.includes("/offers")) {
    return route.fulfill({ json: offers() });
  }
  if (url.includes("/effects")) {
    return route.fulfill({ json: txEffects() });
  }
  if (url.includes(`/accounts/${MISSING}`)) {
    return route.fulfill({ status: 404, json: { status: 404 } });
  }
  if (url.includes(`/accounts/${MALFORMED}`)) {
    // a provider answering 200 with a body of the wrong shape
    return route.fulfill({ json: { account_id: MALFORMED } });
  }
  if (url.includes("/transactions/") && url.includes("/operations")) {
    return route.fulfill({ json: txOperations() });
  }
  if (url.includes(`/transactions/${AGED_HASH}`)) {
    return route.fulfill({
      json: {
        hash: AGED_HASH,
        paging_token: "1",
        successful: true,
        source_account: G,
        source_account_sequence: "1",
        operation_count: 1,
        created_at: "2026-07-31T09:27:52Z",
        fee_charged: "100",
        max_fee: "100",
        memo_type: "none",
        envelope_xdr: AGED_ENVELOPE,
      },
    });
  }
  if (url.includes("/transactions/")) {
    return route.fulfill({
      json: {
        hash: CONTRACT_HASH,
        paging_token: "1",
        successful: true,
        source_account: G,
        source_account_sequence: "1",
        operation_count: 1,
        created_at: "2026-08-24T10:00:00Z",
        fee_charged: "100",
        max_fee: "100",
        memo_type: "none",
      },
    });
  }
  if (url.includes("/operations")) {
    const cursor = new URL(url).searchParams.get("cursor") ?? undefined;
    return route.fulfill({ json: operations(cursor) });
  }
  if (url.includes(`/accounts/${G}`)) {
    return route.fulfill({ json: account() });
  }
  return route.abort();
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

test("renders holdings, signing, and identity", async ({ page }) => {
  await page.goto(`/account/${G}`);

  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();

  // the reserve is three subentries plus the two base entries, and the
  // offer holds ten more back
  await expect(page.getByText("100 XLM")).toBeVisible();
  await expect(
    page.getByText("87.5 spendable, 2.5 reserved, 10 in offers"),
  ).toBeVisible();

  await expect(page.getByText("203069091936010245")).toBeVisible();
  await expect(page.getByText("1 low")).toBeVisible();
  await expect(page.getByText("example.com")).toBeVisible();
  await expect(page.getByText("auth required")).toBeVisible();

  // XLM sorts first even though the provider listed USDC before it
  const assets = await page
    .getByRole("table")
    .first()
    .getByRole("row")
    .allInnerTexts();
  expect(assets[1]).toContain("XLM");
  expect(assets[2]).toContain("USDC");
  await expect(page.getByText("1,000")).toBeVisible();

  await expect(
    page.getByRole("columnheader", { name: "Signer" }),
  ).toBeVisible();
  await expect(page.getByText("ed25519 public key").first()).toBeVisible();

  await expect(page.getByText("greeting")).toBeVisible();
  await expect(page.getByText("aGVsbG8=")).toBeVisible();
});

// the summary carries links now, so a click has to land on the chevron
// rather than in the middle of the row, where an address would take it
test("a held asset upgrades its chip to the issuer's icon", async ({
  page,
}) => {
  // a real 1x1 png; the icon proxy would serve exactly such bytes
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route(INDEXER, (route) => {
    if (route.request().url().endsWith("/icon")) {
      return route.fulfill({ body: PNG, contentType: "image/png" });
    }
    return route.fulfill({ status: 404, json: { error: "no icon" } });
  });

  await page.goto(`/account/${G}`);

  const icon = page.locator(`img[src*="/assets/USDC/${ISSUER}/icon"]`).first();
  await expect(icon).toBeVisible();
});

test("a contract call reads as the call, and opens into its trace", async ({
  page,
}) => {
  await page.goto(`/account/${G}?tab=history`);

  // closed, the row says what kind of thing it was, then the call itself:
  // caller, contract, function, args
  const call = page.getByRole("row").nth(1);
  await expect(call).toContainText("Contract call");
  await expect(call).toContainText("call");
  await expect(call).toContainText("harvest(178651");
  await expect(call).not.toContainText("mint(");

  // open, it is the same tree the transaction page draws, and this one is
  // the real execution, so it carries no reconstruction note
  await call.locator("summary").click({ position: { x: 6, y: 10 } });
  // wait for the tree before asserting what is absent from it, or the
  // absences pass simply because nothing has rendered yet
  await expect(call).toContainText("mint(178650");
  await expect(call).toContainText("9859848");
  await expect(call).not.toContainText("signed authorization data");

  // it picks up where the closed row left off: the call itself is not
  // printed a second time, and the tree needs no header to say what it is
  await expect(call).not.toContainText("Function call");

  // and it lines up with the row above: the branch drops out of the middle
  // of the caller's identicon, past the column the chevron holds
  const columns = await call.evaluate((row) => {
    // the first cell is the type tag; the sentence and its tree are next
    const cell = row.querySelectorAll("td")[1]!;
    const left = cell.getBoundingClientRect().left;
    const icon = cell
      .querySelector("summary")!
      .querySelector("img, canvas, span[aria-hidden]")!
      .getBoundingClientRect();
    const treeCell = cell
      .querySelectorAll("table tbody tr")[0]
      .querySelector("td")!;
    const stem = [...treeCell.querySelectorAll("span")]
      .map((span) => span.getBoundingClientRect())
      .find((box) => box.width <= 1.5 && box.height > 2)!;
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      icon: round(icon.left + icon.width / 2 - left),
      stem: round(stem.left + stem.width / 2 - left),
    };
  });

  expect(columns.stem).toBe(columns.icon);
  const printed = await call.evaluate(
    (row) => (row.textContent ?? "").split("harvest(178651").length - 1,
  );
  expect(printed).toBe(1);
});

test("a trace survives the meta ageing out of RPC retention", async ({
  page,
}) => {
  await page.goto(`/account/${G}?tab=history`);

  // RPC has dropped this transaction's meta, so the only trace left is the
  // one rebuilt from the envelope, exactly as the transaction page does it
  const aged = page.getByRole("row").nth(2);
  await expect(aged).toContainText("harvest(178651");
  await aged.locator("summary").click({ position: { x: 6, y: 10 } });

  await expect(aged).toContainText("mint(178651");
  await expect(aged).not.toContainText("No call trace");
  // and it says what it is: authorization data, not the execution
  await expect(aged).toContainText("signed authorization data");

  // what actually moved comes from the effects, which Horizon keeps for
  // good, so it is there even though the execution meta is gone
  await expect(aged).toContainText("Net change");
  await expect(aged).toContainText("-5.903971 XLM");
  await expect(aged).toContainText("+5.903971 XLM");
});

// a plant()-shaped operation, the only thing that differs between the two
// leaf-call scenarios below is which hash it points at and what that hash's
// meta holds
function leafOperation(hash: string) {
  return {
    id: "leaf",
    paging_token: "999",
    transaction_hash: hash,
    type: "invoke_host_function",
    source_account: G,
    created_at: "2026-08-24T10:00:00Z",
    transaction: { fee_charged: "189", successful: true },
    address: "",
    function: "HostFunctionTypeHostFunctionTypeInvokeContract",
    parameters: [
      { type: "Address", value: CONTRACT_SCVAL },
      { type: "Sym", value: PLANT_SCVAL },
      { type: "Address", value: CONTRACT_SCVAL },
      { type: "I128", value: ZERO_I128_SCVAL },
    ],
  };
}

async function routeSingleHistoryOperation(page: Page, record: unknown) {
  for (const pattern of HORIZON_PROVIDERS) {
    await page.route(pattern, (route) => {
      const url = route.request().url();
      if (url.includes("/operations") && !url.includes("/transactions/")) {
        return route.fulfill({ json: { _embedded: { records: [record] } } });
      }
      return horizonHandler(route);
    });
  }
}

test("a call with nothing further to show says so instead of a blank gap", async ({
  page,
}) => {
  await routeSingleHistoryOperation(page, leafOperation(LEAF_HASH));

  await page.goto(`/account/${G}?tab=history`);
  const call = page.getByRole("row").nth(1);
  await expect(call).toContainText("plant(");
  await call.locator("summary").click({ position: { x: 6, y: 10 } });

  // the call itself made no further calls, raised no events, and touched
  // no storage, so there is nothing to show below it beyond saying that
  await expect(call).toContainText(
    "This call did not make any further calls, emit events, or change storage.",
  );
  await expect(call).not.toContainText("No call trace is available");
});

test("a leaf call that wrote to storage shows what it wrote, not an empty tree", async ({
  page,
}) => {
  await routeSingleHistoryOperation(page, leafOperation(LEAF_STORAGE_HASH));

  await page.goto(`/account/${G}?tab=history`);
  const call = page.getByRole("row").nth(1);
  await expect(call).toContainText("plant(");
  await call.locator("summary").click({ position: { x: 6, y: 10 } });

  // no sub-calls or events for the tree, but the storage write is real
  // information and belongs here instead of the "nothing happened" message,
  // read as a step rather than a table pasted in from another page
  await expect(call).not.toContainText(
    "This call did not make any further calls",
  );
  await expect(call).toContainText("created");
  await expect(call).toContainText("temporary");
  await expect(call).toContainText("Pail");
  await expect(call).toContainText("kept until ledger");
  await expect(call).toContainText("64,151,399");
  // no leftover grid table: a step list only, matching the classic
  // operation steps this same row draws for a non-contract transaction
  await expect(call.getByRole("columnheader")).toHaveCount(0);
});

test("storage steps sit under the tree as their own labeled, self-connected groups", async ({
  page,
}) => {
  await routeSingleHistoryOperation(page, {
    id: "nested-storage",
    paging_token: "999",
    transaction_hash: NESTED_STORAGE_HASH,
    type: "invoke_host_function",
    source_account: G,
    created_at: "2026-08-24T10:00:00Z",
    transaction: { fee_charged: "189", successful: true },
    address: "",
    function: "HostFunctionTypeHostFunctionTypeInvokeContract",
    parameters: [
      { type: "Address", value: CONTRACT_SCVAL },
      { type: "Sym", value: HARVEST_SCVAL },
      { type: "U32", value: U32_SCVAL },
    ],
  });

  await page.goto(`/account/${G}?tab=history`);
  const call = page.getByRole("row").nth(1);
  await call.locator("summary").click({ position: { x: 6, y: 10 } });

  // the real nested call tree renders...
  await expect(call).toContainText("mint(178650");
  // ...and the storage it touched renders too, seam included
  await expect(call).toContainText("State changes");
  await expect(call).toContainText("Storage lifetime");
  await expect(call).toContainText("64,159,000");

  // removed entries and ttl entries are different kinds of things that
  // just happen to come from the same trace, not siblings of one another,
  // so each label owns its own <ol> and its own elbow chain rather than
  // one combined list pretending they are all steps of the same thing;
  // net change is a third such group, grouped the same consistent way
  await expect(call).toContainText("Net change");
  await expect(call.locator("ol")).toHaveCount(3);
});

test("an opened row leads to the transaction it describes", async ({
  page,
}) => {
  await page.goto(`/account/${G}?tab=history`);
  const call = page.getByRole("row").nth(1);
  await call.locator("summary").click({ position: { x: 6, y: 10 } });
  await expect(call).toContainText("mint(178650");

  // the row shows what happened; resources and the fee split live on the
  // transaction page, and this is the way there
  const link = call.getByRole("link", { name: /Open transaction/ });
  await expect(link).toBeVisible();
  await link.click();

  await expect(page).toHaveURL(`/tx/${CONTRACT_HASH}`);
  await expect(
    page.getByRole("heading", { name: "Transaction details" }),
  ).toBeVisible();
});

test("the next page and a pointed-at row are fetched before they are asked for", async ({
  page,
}) => {
  const asked: string[] = [];
  for (const pattern of HORIZON_PROVIDERS) {
    await page.route(pattern, (route) => {
      asked.push(route.request().url());
      return horizonHandler(route);
    });
  }

  await page.goto(`/account/${G}?tab=history`);
  await expect(page.getByRole("row").nth(1)).toContainText("harvest(");

  // the page after this one is already on its way
  await expect
    .poll(() => asked.filter((url) => url.includes("cursor=")).length)
    .toBeGreaterThan(0);

  // pointing at a row fetches what opening it will need
  const before = asked.filter((url) =>
    url.includes(`/transactions/${CONTRACT_HASH}`),
  ).length;
  expect(before).toBe(0);

  await page.getByRole("row").nth(1).hover();
  await expect
    .poll(
      () =>
        asked.filter((url) => url.includes(`/transactions/${CONTRACT_HASH}`))
          .length,
    )
    .toBeGreaterThan(0);
});

test("a new page of history starts at its own top", async ({ page }) => {
  await page.setViewportSize({ width: 1150, height: 420 });
  await page.goto(`/account/${G}?tab=history`);
  await expect(page.getByRole("row").nth(3)).toContainText("sent 1 XLM");

  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(200);

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByLabel("Page 2")).toBeVisible();

  // the reader lands on the first row of the new page, not wherever they
  // happened to be on the last one
  const landed = await page.evaluate(() => {
    const table = document.querySelector("thead")!.getBoundingClientRect();
    return { scrollY: window.scrollY, headerTop: table.top };
  });
  expect(landed.scrollY).toBeLessThan(scrolled);
  // the table header sits just under the pager, which sits under the navbar
  expect(landed.headerTop).toBeLessThan(200);
});

test("history says what each transaction cost", async ({ page }) => {
  await page.goto(`/account/${G}?tab=history`);

  // the fee is the transaction's, joined into the same request that
  // fetched the operations, so no row waits on a second one
  await expect(page.getByRole("columnheader", { name: "Fee" })).toBeVisible();
  await expect(page.getByRole("row").nth(1)).toContainText("0.00001 XLM");
  await expect(page.getByRole("row").nth(3)).toContainText("0.00002 XLM");

  // and when it happened, both as a glance and as a timestamp. The glance is
  // relative to now, so only its shape can be asserted here; what it counts
  // is pinned by the unit tests for formatAgo
  const age = page.getByRole("row").nth(3);
  await expect(age).toContainText(/\d+[smhd] ago/);
  await expect(age).toContainText("Aug 24, 2026, 10:00:00 UTC");
});

test("history groups a transaction's operations into one row", async ({
  page,
}) => {
  await page.goto(`/account/${G}?tab=history`);

  // three of the operations share a transaction, so they are one row that
  // says how many it carries
  const grouped = page.getByRole("row").nth(3);
  await expect(grouped).toContainText("Payment");
  await expect(grouped).toContainText("and 2 more operations");

  // opening it fetches that transaction's own operations, and every step
  // of the transaction is listed under it
  await expect(page.getByText("created account")).toBeHidden();
  await grouped.locator("summary").click({ position: { x: 6, y: 10 } });
  await expect(page.getByText("created account")).toBeVisible();
  // the first ordered list is the transaction's steps; the net changes
  // below it are their own separate list, grouped the same way
  await expect(grouped.locator("ol").first().locator("li")).toHaveCount(3);
});

test("history pages forward and back by cursor", async ({ page }) => {
  await page.goto(`/account/${G}?tab=history`);

  // the two pages carry different amounts, so a row says which page it is
  const firstPayment = page.getByRole("row").nth(3);
  await expect(firstPayment).toContainText("sent 1 XLM");
  await expect(page.getByRole("button", { name: "First" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Previous page" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByLabel("Page 2")).toBeVisible();
  await expect(firstPayment).toContainText("sent 101 XLM");

  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(page.getByLabel("Page 1")).toBeVisible();
  await expect(firstPayment).toContainText("sent 1 XLM");
});

test("the pager and the column headers stay in view while rows scroll", async ({
  page,
}) => {
  // wide enough that the table fits: below lg the wrapper scrolls sideways
  // and owns the sticky positioning instead of the page
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto(`/account/${G}?tab=history`);
  await expect(page.getByRole("row").nth(1)).toContainText("harvest(");

  const stack = await page.evaluate(async () => {
    window.scrollTo(0, 800);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const first = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "First",
    )!;
    const pager = first.parentElement!.getBoundingClientRect();
    const header = document.querySelector("th")!.getBoundingClientRect();
    return {
      siteHeaderBottom: document
        .querySelector("header")!
        .getBoundingClientRect().bottom,
      pagerTop: pager.top,
      pagerBottom: pager.bottom,
      headerTop: header.top,
    };
  });

  // the three bands stack with no gap and no overlap
  expect(stack.pagerTop).toBe(stack.siteHeaderBottom);
  expect(stack.headerTop).toBe(stack.pagerBottom);

  // nothing shows through the bands: the table bleeds past the page
  // padding, so the points that matter are the edges of the table itself
  const leaks = await page.evaluate(() => {
    const pager = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "First")!
      .parentElement!.getBoundingClientRect();
    const header = document.querySelector("thead")!.getBoundingClientRect();
    const found: string[] = [];
    [pager, header].forEach((band, index) => {
      // the top edge matters as much as the middle: a rounded corner lets a
      // pointer through to the row behind, which then hovers and shows
      for (const y of [band.top + 1, band.top + band.height / 2]) {
        for (const x of [
          header.left + 1,
          header.left + 8,
          header.left + header.width / 2,
          header.right - 8,
          header.right - 1,
        ]) {
          if (document.elementFromPoint(x, y)?.closest("tbody") !== null) {
            found.push(
              `band ${index} reaches a row at ${Math.round(x)},${Math.round(y)}`,
            );
          }
        }
      }
    });
    return found;
  });

  expect(leaks, leaks.join("; ")).toEqual([]);

  // a band can also leak by being see-through rather than by sitting under
  // a row, which no hit test would notice
  const seeThrough = await page.evaluate(() => {
    const painted = [
      document.querySelector("header")!,
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "First",
      )!.parentElement!,
      // the header row carries the fill, not the cells inside it
      document.querySelector("thead tr")!,
    ];
    // colours arrive in whatever space the theme uses, so the alpha is read
    // from the slash form as well as from rgba()
    const alphaOf = (colour: string) => {
      const slashed = /\/\s*([\d.]+)\s*\)/.exec(colour);
      if (slashed !== null) {
        return Number(slashed[1]);
      }
      const rgba = /rgba\(([^)]+)\)/.exec(colour);
      if (rgba === null) {
        return 1;
      }
      const channels = rgba[1].split(",").map(Number);
      return channels.length === 4 ? channels[3] : 1;
    };
    return painted
      .map((element, index) => {
        const style = getComputedStyle(element);
        return alphaOf(style.backgroundColor) !== 1 ||
          style.backdropFilter !== "none"
          ? `band ${index} is see-through (${style.backgroundColor})`
          : null;
      })
      .filter((problem) => problem !== null);
  });

  expect(seeThrough, seeThrough.join("; ")).toEqual([]);
  // and the controls are still reachable without scrolling back up
  await expect(
    page.getByRole("button", { name: "Next page" }),
  ).toBeInViewport();
});

test("the open tab travels in the url", async ({ page }) => {
  await page.goto(`/account/${G}?tab=history`);
  await expect(page.getByRole("tab", { name: "History" })).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(page.getByRole("row").nth(1)).toContainText("harvest(");

  await page.getByRole("tab", { name: "Details" }).click();
  await expect(page).toHaveURL(`/account/${G}`);

  await page.goto(`/account/${G}?tab=nonsense`);
  await expect(page.getByRole("tab", { name: "Details" })).toHaveAttribute(
    "data-state",
    "active",
  );
});

test("offers show what the account has standing on the order book", async ({
  page,
}) => {
  await page.goto(`/account/${G}?tab=offers`);

  await expect(
    page.getByRole("columnheader", { name: "Selling" }),
  ).toBeVisible();
  const first = page.getByRole("row").nth(1);
  await expect(first).toContainText("USDC");
  await expect(first).toContainText("XLM");
  // an amount past what a float holds keeps every digit
  await expect(first).toContainText("912,880,747,704.388832");
  await expect(first).toContainText("0.1234567");
});

test("a muxed address is looked up as the account inside it", async ({
  page,
}) => {
  const asked: string[] = [];
  for (const pattern of HORIZON_PROVIDERS) {
    await page.route(pattern, (route) => {
      asked.push(route.request().url());
      return horizonHandler(route);
    });
  }

  await page.goto(`/account/${MUXED}`);

  await expect(page.getByText("100 XLM")).toBeVisible();
  // the lookup used the account, never the M form Horizon would reject
  expect(asked.some((url) => url.includes(`/accounts/${G}`))).toBe(true);
  expect(asked.some((url) => url.includes("/accounts/M"))).toBe(false);

  // and the page says whose account this is and which subaccount was asked
  await expect(page.getByText(G, { exact: false }).first()).toBeVisible();
  await expect(page.getByText("subaccount 1")).toBeVisible();
});

test("an unfunded address says so instead of failing", async ({ page }) => {
  await page.goto(`/account/${MISSING}`);

  await expect(
    page.getByText("does not exist on the ledger", { exact: false }),
  ).toBeVisible();
});

test("a malformed provider body degrades instead of crashing the page", async ({
  page,
}) => {
  await page.goto(`/account/${MALFORMED}`);

  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(
    page.getByText("Could not load this account", { exact: false }),
  ).toBeVisible();
});

test("a direct URL that is not an account address is rejected", async ({
  page,
}) => {
  await page.goto("/account/not-an-address");

  await expect(
    page.getByRole("heading", { name: "Not a valid account address" }),
  ).toBeVisible();
});
