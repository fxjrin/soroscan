import { expect, test, type Page, type Route } from "@playwright/test";
import { blockLiveHosts, HORIZON_PROVIDERS, RPC_PROVIDERS } from "./hermetic";

const HASH = "beef".repeat(16);
const FAILED_HASH = "dead".repeat(16);
const SOROBAN_HASH = "cafe".repeat(16);
const MALFORMED_HASH = "1234".repeat(16);
// a genuine classic payment envelope and its result, so the decoded tab
// walks a real structure; this one carries both + and / so the lab link
// has to escape base64 the way the lab expects
const ENVELOPE_XDR =
  "AAAAAgAAAAAiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIgAAAIYAAAAAAAAAIwAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAPv7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7AAAAAAAAAAAAmJaiAAAAAAAAAAA=";
const RESULT_XDR = "AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAA=";
const G1 = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const G2 = "GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S";
const CONTRACT = "CAS5PJYZQ74Z7W3YO24J6MX47WG6UFY52Z4JESCAE5I4COZFPAN664B3";
const CONTRACT_SCVAL =
  "AAAAEgAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQ==";
const TRANSFER_SCVAL = "AAAADwAAAAh0cmFuc2Zlcg==";
const HARVEST_SCVAL = "AAAADwAAAAdoYXJ2ZXN0AA=="; // symbol "harvest"
const U32_SCVAL = "AAAAAwACuds="; // u32 178651
const I128_SCVAL = "AAAACgAAAAAAAAAAAAAAAABJAAE="; // i128 4784129
const VEC_SCVAL = "AAAAEAAAAAEAAAACAAAAAwAAAAEAAAADAAAAAg=="; // vec [u32 1, u32 2]
const ACCOUNT_SCVAL =
  "AAAAEgAAAAAAAAAABwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
// TransactionMetaV3: return value i128 7878706; diagnostic events tracing
// harvest(178651) calling mint(178650) returning i128 9859848 with a mint contract
// event inside the mint frame; ledger changes removing and re-creating the
// temporary "Pail" entry plus a ttl row whose key hash is the real sha-256
// of the Pail ledger key, live until ledger 64121306; core_metrics counters
// and a v1 meta ext with the resource fee split
const RESULT_META_XDR =
  "AAAAAwAAAAAAAAAAAAAAAQAAAAMAAAACAAAABgAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQAAAA8AAAAEUGFpbAAAAAAAAAABAAAAAQAAAAkqN3ZPeQMnvPzkeOjhHEPM+0L39uNfeL07eE/5TOaVDQPSadoAAAAAAAAAAAAAAAEAAAAGAAAAAAAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQAAAA8AAAAEUGFpbAAAAAAAAAADAAK52wAAAAAAAAAAAAAAAQAAAAEAAAAAAAAAAAAAtiEAAAAAAAAl/wAAAAAAAAAAAAAAAAAAAAoAAAAAAAAAAAAAAAAAeDgyAAAADgAAAAEAAAAAAAAAAAAAAAIAAAAAAAAAAwAAAA8AAAAHZm5fY2FsbAAAAAANAAAAINeSi3LCcDzP6vfrn/TvTVBKVai5efybRQ6iyEK00c5hAAAADwAAAAdoYXJ2ZXN0AAAAABAAAAABAAAAAQAAAAMAArnbAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAADAAAADwAAAAdmbl9jYWxsAAAAAA0AAAAg15KLcsJwPM/q9+uf9O9NUEpVqLl5/JtFDqLIQrTRzmEAAAAPAAAABG1pbnQAAAAQAAAAAQAAAAEAAAADAAK52gAAAAEAAAAAAAAAAdeSi3LCcDzP6vfrn/TvTVBKVai5efybRQ6iyEK00c5hAAAAAQAAAAAAAAABAAAADwAAAARtaW50AAAACgAAAAAAAAAAAAAAAACWcwgAAAABAAAAAAAAAAAAAAACAAAAAAAAAAIAAAAPAAAACWZuX3JldHVybgAAAAAAAA8AAAAEbWludAAAAAoAAAAAAAAAAAAAAAAAlnMIAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAlmbl9yZXR1cm4AAAAAAAAPAAAAB2hhcnZlc3QAAAAACgAAAAAAAAAAAAAAAAB4ODIAAAABAAAAAAAAAAAAAAACAAAAAAAAAAIAAAAPAAAADGNvcmVfbWV0cmljcwAAAA8AAAAKcmVhZF9lbnRyeQAAAAAABQAAAAAAAAAYAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAxjb3JlX21ldHJpY3MAAAAPAAAAC3dyaXRlX2VudHJ5AAAAAAUAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAIAAAAAAAAAAgAAAA8AAAAMY29yZV9tZXRyaWNzAAAADwAAABBsZWRnZXJfcmVhZF9ieXRlAAAABQAAAAAAAAB0AAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAxjb3JlX21ldHJpY3MAAAAPAAAAEWxlZGdlcl93cml0ZV9ieXRlAAAAAAAABQAAAAAAAAB0AAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAxjb3JlX21ldHJpY3MAAAAPAAAACmVtaXRfZXZlbnQAAAAAAAUAAAAAAAAACQAAAAEAAAAAAAAAAAAAAAIAAAAAAAAAAgAAAA8AAAAMY29yZV9tZXRyaWNzAAAADwAAAA9lbWl0X2V2ZW50X2J5dGUAAAAABQAAAAAAAAfIAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAxjb3JlX21ldHJpY3MAAAAPAAAACGNwdV9pbnNuAAAABQAAAAAAnMcAAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAxjb3JlX21ldHJpY3MAAAAPAAAACG1lbV9ieXRlAAAABQAAAAAAyYkRAAAAAQAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAxjb3JlX21ldHJpY3MAAAAPAAAAEWludm9rZV90aW1lX25zZWNzAAAAAAAABQAAAAAAFC/4";

function detail(hash: string, successful: boolean) {
  return {
    hash,
    paging_token: "275000000000000000",
    successful,
    source_account: G1,
    operation_count: 2,
    created_at: "2026-08-24T10:00:00Z",
    fee_charged: "200",
    max_fee: "1000",
    ledger: 64000123,
    memo_type: "text",
    memo: "hello\u202Eworld",
    envelope_xdr: ENVELOPE_XDR,
    result_xdr: RESULT_XDR,
    fee_meta_xdr: "AAAAAgAAAAMFEEMETA=",
    source_account_sequence: "203069091936010245",
    fee_account: successful ? G1 : G2,
    signatures: ["c2ln", "bmF0dXJl"],
  };
}

function operations(hash: string) {
  return {
    _embedded: {
      records: [
        {
          id: "1",
          paging_token: "275000000000000001",
          transaction_hash: hash,
          type: "payment",
          source_account: G1,
          from: G1,
          to: G2,
          amount: "12.5000000",
          asset_type: "native",
        },
        {
          id: "2",
          paging_token: "275000000000000002",
          transaction_hash: hash,
          type: "invoke_host_function",
          source_account: G1,
          address: "",
          function: "HostFunctionTypeHostFunctionTypeInvokeContract",
          parameters: [
            { type: "Address", value: CONTRACT_SCVAL },
            { type: "Sym", value: TRANSFER_SCVAL },
          ],
          asset_balance_changes: [
            {
              type: "transfer",
              from: G1,
              to: G2,
              amount: "3.0000000",
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
            },
          ],
        },
      ],
    },
  };
}

function sorobanOperations() {
  return {
    _embedded: {
      records: [
        {
          id: "1",
          paging_token: "276000000000000001",
          transaction_hash: SOROBAN_HASH,
          type: "invoke_host_function",
          source_account: G1,
          address: "",
          function: "HostFunctionTypeHostFunctionTypeInvokeContract",
          parameters: [
            { type: "Address", value: CONTRACT_SCVAL },
            { type: "Sym", value: HARVEST_SCVAL },
            { type: "U32", value: U32_SCVAL },
            { type: "I128", value: I128_SCVAL },
            { type: "Vec", value: VEC_SCVAL },
            { type: "Address", value: ACCOUNT_SCVAL },
          ],
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
  if (request.method !== "getTransaction") {
    return route.abort();
  }
  const found = request.params?.hash === SOROBAN_HASH;
  return route.fulfill({
    json: {
      jsonrpc: "2.0",
      id: request.id,
      result: found
        ? { status: "SUCCESS", resultMetaXdr: RESULT_META_XDR }
        : { status: "NOT_FOUND" },
    },
  });
}

function effects() {
  return {
    _embedded: {
      records: [
        {
          id: "e1",
          _links: {
            operation: { href: "https://horizon.stellar.org/operations/1" },
          },
          type: "account_debited",
          account: G1,
          amount: "12.5000000",
          asset_type: "native",
        },
        {
          id: "e2",
          _links: {
            operation: { href: "https://horizon.stellar.org/operations/2" },
          },
          type: "account_credited",
          account: G2,
          amount: "12.5000000",
          asset_type: "native",
        },
        {
          // Horizon names the calling account here too, so the row must
          // read the contract field to say whose balance moved
          id: "e3",
          _links: {
            operation: { href: "https://horizon.stellar.org/operations/2" },
          },
          type: "contract_credited",
          account: G1,
          contract: CONTRACT,
          amount: "3.0000000",
          asset_type: "native",
        },
      ],
    },
  };
}

function horizonHandler(route: Route) {
  const url = route.request().url();
  if (url.includes("/effects")) {
    return route.fulfill({ json: effects() });
  }
  if (url.includes(`/transactions/${HASH}/operations`)) {
    return route.fulfill({ json: operations(HASH) });
  }
  if (url.includes(`/transactions/${HASH}`)) {
    return route.fulfill({ json: detail(HASH, true) });
  }
  if (url.includes(`/transactions/${FAILED_HASH}/operations`)) {
    return route.fulfill({ json: operations(FAILED_HASH) });
  }
  if (url.includes(`/transactions/${FAILED_HASH}`)) {
    return route.fulfill({ json: detail(FAILED_HASH, false) });
  }
  if (url.includes(`/transactions/${SOROBAN_HASH}/operations`)) {
    return route.fulfill({ json: sorobanOperations() });
  }
  if (url.includes(`/transactions/${SOROBAN_HASH}`)) {
    return route.fulfill({
      json: { ...detail(SOROBAN_HASH, true), operation_count: 1 },
    });
  }
  if (url.includes(`/transactions/${MALFORMED_HASH}`)) {
    // a provider answering 200 with a body of the wrong shape
    return route.fulfill({ json: { _embedded: { records: [] } } });
  }
  if (url.includes("/transactions/")) {
    return route.fulfill({ status: 404, json: { status: 404 } });
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

test("renders the overview and decoded operations", async ({ page }) => {
  await page.goto(`/tx/${HASH}`);

  await expect(
    page.getByRole("heading", { name: "Transaction" }),
  ).toBeVisible();
  await expect(page.getByText("succeeded")).toBeVisible();
  await expect(page.getByText("sent 12.5 XLM to")).toBeVisible();
  await expect(page.getByText("and 1 more operation")).toBeVisible();
  await expect(page.getByText(HASH)).toBeVisible();
  await expect(page.getByText(G1).first()).toBeVisible();
  await page.getByText("More details").click();
  await expect(page.getByText("203069091936010245")).toBeVisible();
  await expect(page.getByText("c2ln")).toBeVisible();
  await expect(page.getByText("bmF0dXJl")).toBeVisible();
  await expect(page.getByRole("link", { name: "64,000,123" })).toBeVisible();
  await expect(page.getByText("0.00002 XLM")).toBeVisible();
  await expect(page.getByText("hello\uFFFDworld")).toBeVisible();
  await expect(page.getByText("Aug 24, 2026, 10:00:00 UTC")).toBeVisible();
  await expect(page.getByText("Payment").first()).toBeVisible();

  await page.getByRole("tab", { name: "Operations" }).click();
  // every operation carries the transaction-level ledger, age, and fee
  await expect(
    page.getByRole("columnheader", { name: "Ledger" }),
  ).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Fee" })).toBeVisible();
  await expect(page.getByText("Contract call")).toBeVisible();
  await expect(page.getByText("transfer", { exact: true })).toBeVisible();
  await expect(page.getByText("CDLZ...CYSC")).toBeVisible();
  await expect(page.getByText("USDC")).toBeVisible();

  await page.getByRole("tab", { name: "Balance changes" }).click();
  await expect(
    page.getByRole("columnheader", { name: "Holder" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Amount" }),
  ).toBeVisible();
  // the summary settles the effects into one signed total per account,
  // and the table below still itemises every movement
  await expect(page.getByText("Net change")).toBeVisible();
  await expect(page.getByRole("table").getByText("-12.5 XLM")).toBeVisible();
  await expect(page.getByRole("table").getByText("+12.5 XLM")).toBeVisible();
  await expect(page.getByText("account credited")).toBeVisible();
  // a contract movement is attributed to the contract, never to the caller
  await expect(page.getByText("contract credited")).toBeVisible();
  await expect(page.getByRole("table").getByText("CAS5...64B3")).toBeVisible();
  // each movement names the operation it came out of
  await expect(
    page.getByRole("columnheader", { name: "From operation" }),
  ).toBeVisible();
  await expect(page.getByRole("table").getByText("Payment")).toBeVisible();

  await page.getByRole("tab", { name: "XDR" }).click();
  await expect(page.getByText("Envelope", { exact: true })).toBeVisible();
  await expect(page.getByText(ENVELOPE_XDR)).toBeVisible();
  await expect(page.getByText("Fee meta")).toBeVisible();
  const labLink = page.getByRole("link", { name: "Decode in Stellar Lab" });
  await expect(labLink.first()).toBeVisible();
  // assert what the lab actually receives. it reads the raw query string,
  // so nothing is percent-encoded, and its escape character is a slash,
  // which base64 also uses: an unescaped slash truncates the blob
  const href = (await labLink.first().getAttribute("href")) ?? "";
  const state = href.slice(href.indexOf("?$=") + 3);
  expect(state).toContain(`blob=${ENVELOPE_XDR.replaceAll("/", "//")}`);
  expect(state).toContain("type=TransactionEnvelope");
  expect(state).not.toContain("%");

  await page.getByRole("tab", { name: "Decoded" }).click();
  // the blob is walked into real fields, with the source account as a
  // strkey and the 64-bit sequence number kept as text
  await expect(
    page.getByText("source_account", { exact: false }).first(),
  ).toBeVisible();
  // raw key bytes came back out as a strkey, and the operation body as a
  // named variant, so the walk really decoded rather than echoed
  await expect(
    page.getByText("GARCEIRCEIRC", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("payment", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("seq_num", { exact: false })).toBeVisible();
  // every object is a disclosure, so a reader can fold a subtree away and
  // still see how many entries it holds
  const operations = page
    .locator("details.json-branch")
    .filter({ hasText: "operations" })
    .last();
  await expect(
    operations.getByText("destination", { exact: false }),
  ).toBeVisible();
  await operations.locator("summary").first().click();
  await expect(
    operations.getByText("destination", { exact: false }),
  ).toBeHidden();
});

test("decodes a contract call: function, arguments, and return value", async ({
  page,
}) => {
  await page.goto(`/tx/${SOROBAN_HASH}`);

  await expect(page.getByText("called")).toBeVisible();
  await expect(page.getByText("Function call", { exact: true })).toBeVisible();
  const signature = page.locator("code");
  await expect(signature).toContainText("harvest(");
  await expect(signature).toContainText("178651");
  await expect(signature).toContainText("4784129");
  // the return arrow is an icon, so the value follows the label it carries
  await expect(signature.getByLabel("returns")).toBeVisible();
  await expect(signature).toContainText("7878706");
  await expect(page.getByText("CDLZ...CYSC").first()).toBeVisible();

  // an address argument carries an identicon and a copy button; neither may
  // lift its text off the baseline of the expression around it
  const baselines = await page
    .locator("code")
    .first()
    .evaluate((code) => {
      const tops = new Set<number>();
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if ((node.textContent ?? "").trim() === "") continue;
        const parent = node.parentElement!;
        if (getComputedStyle(parent).verticalAlign === "sub") continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        tops.add(Math.round(range.getBoundingClientRect().top * 2) / 2);
      }
      return [...tops];
    });
  expect(baselines).toHaveLength(1);

  await page.getByRole("tab", { name: "Trace" }).click();
  const trace = page.getByRole("tabpanel");
  await expect(trace).toContainText("harvest(178651");
  await expect(trace).toContainText("mint(178650");
  await expect(trace).toContainText("9859848");
  // the executed tree needs no auth disclaimer
  await expect(trace).not.toContainText("authorization");
  // the mint contract event sits inside the mint frame
  await expect(trace).toContainText("event");
  await expect(trace.getByText("mint", { exact: true })).toHaveCount(2);
  // ledger changes: removed and re-created Pail entry, plus a ttl bump
  await expect(trace).toContainText("State changes");
  await expect(trace).toContainText("removed");
  await expect(trace).toContainText("created");
  // the storage key is a symbol, shown bare with its sym tag, never quoted
  await expect(trace).toContainText("Pailsym");
  await expect(trace).toContainText("178651");
  await expect(
    page.getByRole("columnheader", { name: "Durability" }),
  ).toBeVisible();
  await expect(trace).not.toContainText('"Pail"');
  await expect(trace).toContainText("temporary");
  await expect(trace).toContainText("Storage lifetime");
  // the ttl key hash resolves to the Pail entry's contract and kind
  await expect(trace).toContainText("contract state");
  await expect(trace).toContainText("2a37764f...4ce6950d");
  await expect(
    page.getByRole("columnheader", { name: "Live until ledger" }),
  ).toBeVisible();
  // the tree now says what it is, like every other block on the tab
  await expect(trace).toContainText("Call tree");
  await expect(trace.getByRole("link", { name: "64,121,306" })).toBeVisible();
  // measured resources from core_metrics and the fee split from the meta
  await expect(trace).toContainText("Resources");
  await expect(trace).toContainText("Entries read");
  await expect(trace).toContainText("24");
  await expect(trace).toContainText("Instructions");
  await expect(trace).toContainText("10,274,560");
  await expect(trace).toContainText("Memory used");
  await expect(trace).toContainText("13,207,825 B");
  await expect(trace).toContainText("Events emitted");
  await expect(trace).toContainText("9 (1,992 B)");
  await expect(trace).toContainText("Invoke time");
  await expect(trace).toContainText("1.32 ms");
  await expect(trace).toContainText("Resource fees");
  await expect(trace).toContainText(
    "46,625 non-refundable + 9,727 refundable + 0 rent stroops",
  );
  // the trace tab badge counts the executed calls
  await expect(page.getByRole("tab", { name: "Trace 2" })).toBeVisible();
});

test("call tree elbows point at the first line of a wrapped row", async ({
  page,
}) => {
  // narrow enough that a signature wraps but a shallower one does not
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(`/tx/${SOROBAN_HASH}`);
  await page.getByRole("tab", { name: "Trace" }).click();
  // the overview also prints harvest(...), and the loading skeleton carries
  // the same section label, so the wait is for a decoded row of the tree
  await expect(
    page.getByRole("tabpanel").getByRole("table").first(),
  ).toContainText("harvest(");

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("td")].slice(0, 3).map((cell) => {
      const top = cell.getBoundingClientRect().top;
      const elbow = [...cell.querySelectorAll("span")]
        .map((span) => span.getBoundingClientRect())
        .find((box) => box.height === 1 && box.width > 2);
      return {
        height: Math.round(cell.getBoundingClientRect().height),
        elbow: elbow ? Math.round((elbow.top - top) * 100) / 100 : null,
      };
    }),
  );

  // a root call has no elbow of its own, so only nested rows are compared
  const nested = rows.filter((row) => row.elbow !== null);
  const wrapped = nested.find((row) => row.height > 45);
  const single = nested.find((row) => row.height < 45);
  expect(wrapped).toBeDefined();
  expect(single).toBeDefined();
  expect(wrapped?.elbow).toBe(single?.elbow);
});

test("the loading rows land where the real rows will", async ({ page }) => {
  // the two queries land one after the other, and the page must not move at
  // either step: not when the transaction arrives, not when its operations do
  let releaseTx = () => {};
  let releaseOps = () => {};
  const heldTx = new Promise<void>((resolve) => {
    releaseTx = resolve;
  });
  const heldOps = new Promise<void>((resolve) => {
    releaseOps = resolve;
  });
  for (const pattern of HORIZON_PROVIDERS) {
    await page.route(pattern, async (route) => {
      const url = route.request().url();
      if (url.includes(`/transactions/${HASH}/operations`)) {
        await heldOps;
        return route.fulfill({ json: operations(HASH) });
      }
      if (url.includes(`/transactions/${HASH}`) && !url.includes("/effects")) {
        await heldTx;
        return route.fulfill({ json: detail(HASH, true) });
      }
      return horizonHandler(route);
    });
  }

  // narrow enough that the hash wraps to two lines: a placeholder that took
  // one line would move every row below it once the real value arrived, and
  // a wider glyph set is enough to reach this on a machine with other fonts
  await page.setViewportSize({ width: 700, height: 720 });
  await page.goto(`/tx/${HASH}`);
  // rows past From depend on what the transaction did, so only the ones
  // every transaction has can be compared
  const labels = ["Transaction hash", "Status and operation", "Ledger", "From"];
  const loading = await boxesOf(page, labels);

  releaseTx();
  await expect(page.getByText("succeeded")).toBeVisible();
  const settled = await boxesOf(page, labels);

  releaseOps();
  await expect(page.getByText("sent 12.5 XLM to")).toBeVisible();
  const complete = await boxesOf(page, labels);

  expect(settled).toEqual(loading);
  expect(complete).toEqual(loading);
});

async function boxesOf(page: Page, labels: string[]) {
  const boxes: Record<string, { x: number; y: number }> = {};
  for (const label of labels) {
    const box = await page
      .getByText(label, { exact: true })
      .first()
      .boundingBox();
    boxes[label] = { x: Math.round(box?.x ?? -1), y: Math.round(box?.y ?? -1) };
  }
  return boxes;
}

test("the open tab travels in the url", async ({ page }) => {
  await page.goto(`/tx/${SOROBAN_HASH}?tab=trace`);
  await expect(
    page.getByRole("tabpanel").getByRole("table").first(),
  ).toContainText("harvest(");
  await expect(page.getByRole("tab", { name: "Trace 2" })).toHaveAttribute(
    "data-state",
    "active",
  );

  await page.getByRole("tab", { name: "XDR" }).click();
  await expect(page).toHaveURL(/\?tab=xdr$/);

  // the overview is the bare url, so a shared link to it carries no query
  await page.getByRole("tab", { name: "Details" }).click();
  await expect(page).toHaveURL(`/tx/${SOROBAN_HASH}`);

  // the trace tab exists on every transaction, so the link opens it and the
  // panel explains itself rather than the page choosing another tab
  await page.goto(`/tx/${HASH}?tab=trace`);
  await expect(page.getByRole("tab", { name: "Trace" })).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(page.getByRole("tabpanel")).toContainText(
    "did not call a contract",
  );

  // a name that is not a tab at all still lands on the overview
  await page.goto(`/tx/${HASH}?tab=nonsense`);
  await expect(page.getByRole("tab", { name: "Details" })).toHaveAttribute(
    "data-state",
    "active",
  );
});

test("a shared tab link never shows the overview on the way", async ({
  page,
}) => {
  // both queries are held, so every frame between the first paint and the
  // decoded trace can be inspected
  let releaseTx = () => {};
  let releaseOps = () => {};
  const heldTx = new Promise<void>((resolve) => {
    releaseTx = resolve;
  });
  const heldOps = new Promise<void>((resolve) => {
    releaseOps = resolve;
  });
  for (const pattern of HORIZON_PROVIDERS) {
    await page.route(pattern, async (route) => {
      const url = route.request().url();
      if (url.includes(`/transactions/${SOROBAN_HASH}/operations`)) {
        await heldOps;
        return route.fulfill({ json: sorobanOperations() });
      }
      if (url.includes(`/transactions/${SOROBAN_HASH}`)) {
        await heldTx;
        return route.fulfill({
          json: { ...detail(SOROBAN_HASH, true), operation_count: 1 },
        });
      }
      return horizonHandler(route);
    });
  }

  await page.goto(`/tx/${SOROBAN_HASH}?tab=trace`);
  // the placeholder already shows the call tree, not the overview rows
  await expect(page.getByText("Call tree")).toBeVisible();
  await expect(page.getByText("Transaction hash")).toBeHidden();
  // and the hash is a placeholder rather than text that is about to vanish
  await expect(page.getByText(SOROBAN_HASH)).toBeHidden();

  releaseTx();
  await expect(page.getByText("Call tree")).toBeVisible();
  await expect(page.getByText("Transaction hash")).toBeHidden();

  releaseOps();
  await expect(
    page.getByRole("tabpanel").getByRole("table").first(),
  ).toContainText("harvest(");
  await expect(page.getByRole("tab", { name: "Trace 2" })).toHaveAttribute(
    "data-state",
    "active",
  );
});

test("the tab strip never gains or moves a tab while loading", async ({
  page,
}) => {
  let releaseOps = () => {};
  const heldOps = new Promise<void>((resolve) => {
    releaseOps = resolve;
  });
  for (const pattern of HORIZON_PROVIDERS) {
    await page.route(pattern, async (route) => {
      if (route.request().url().includes("/operations")) {
        await heldOps;
        return route.fulfill({ json: sorobanOperations() });
      }
      return horizonHandler(route);
    });
  }

  await page.goto(`/tx/${SOROBAN_HASH}`);
  await expect(page.getByRole("tab", { name: "Details" })).toBeVisible();
  const before = await page.getByRole("tab").allInnerTexts();
  const beforeX = (await page.getByRole("tab", { name: "XDR" }).boundingBox())
    ?.x;

  releaseOps();
  await expect(page.getByRole("tab", { name: "Operations 1" })).toBeVisible();
  const after = await page.getByRole("tab").allInnerTexts();
  const afterX = (await page.getByRole("tab", { name: "XDR" }).boundingBox())
    ?.x;

  // the trace tab is there from the first paint, so no tab is inserted
  // beside the others once the operations answer
  expect(before.length).toBe(after.length);
  expect(before[1]).toContain("Trace");
  expect(afterX).toBe(beforeX);
});

test("a failed transaction says so", async ({ page }) => {
  await page.goto(`/tx/${FAILED_HASH}`);

  await expect(page.getByText("failed", { exact: true })).toBeVisible();
  await expect(
    page.getByText("state changes were rolled back", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Fee paid by")).toBeVisible();
});

test("an unknown hash explains ingestion lag instead of a bare 404", async ({
  page,
}) => {
  await page.goto(`/tx/${"aaaa".repeat(16)}`);

  await expect(
    page.getByText("not in the provider's history", { exact: false }),
  ).toBeVisible();
});

test("a malformed hash is rejected before any request", async ({ page }) => {
  await page.goto("/tx/not-a-hash");

  await expect(page.getByText("transaction hash")).toBeVisible();
});

test("a malformed provider body degrades instead of crashing the page", async ({
  page,
}) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(String(error)));

  await page.goto(`/tx/${MALFORMED_HASH}`);

  await expect(
    page.getByText("data providers are unreachable", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Unexpected Application Error")).toHaveCount(0);
  expect(crashes).toEqual([]);
});

test("hovering an address reveals it in full and marks its other occurrences", async ({
  page,
}) => {
  await page.goto(`/tx/${HASH}`);

  // the summary line is the last thing the operations query paints, so
  // waiting for it keeps a later render from adding addresses after the
  // count and before the hover
  await expect(page.getByText("sent 12.5 XLM to")).toBeVisible();
  const instances = page.locator(`[data-address="${G1}"]`);
  const total = await instances.count();
  expect(total).toBeGreaterThan(1);

  // nothing is marked until a reader points at one of them
  await expect(page.locator("[data-match]")).toHaveCount(0);

  await instances.first().hover();

  await expect(page.locator(`[data-address="${G1}"][data-match]`)).toHaveCount(
    total,
  );
  // a different account on the same page stays unmarked
  await expect(page.locator(`[data-address="${G2}"][data-match]`)).toHaveCount(
    0,
  );
  // and the untruncated value is readable without copying it out
  await expect(page.getByRole("tooltip")).toContainText(G1);

  await page.mouse.move(0, 0);
  await expect(page.locator("[data-match]")).toHaveCount(0);
});

test("an address is a link to the entity it names", async ({ page }) => {
  await page.goto(`/tx/${HASH}`);

  const link = page.getByRole("link", { name: G2 });
  await expect(link.first()).toBeVisible();

  await link.first().click();

  await expect(page).toHaveURL(new RegExp(`/account/${G2}$`));
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
});
