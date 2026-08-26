import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  fetchAccount,
  fetchAccountOperations,
  fetchTransactionMeta,
  fetchLatestLedgers,
  fetchLedger,
  fetchTransaction,
  horizonGet,
  NotFoundError,
} from "./client";
import { resetFailoverState, UpstreamError } from "@/lib/failover";

beforeEach(() => {
  resetFailoverState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function response(status: number, body = "{}") {
  return new Response(body, { status });
}

test("builds the query string and hits the first provider", async () => {
  const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) =>
    response(200, '{"_embedded":{"records":[]}}'),
  );
  vi.stubGlobal("fetch", fetchMock);

  await fetchLatestLedgers("testnet", 3);

  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://horizon-testnet.stellar.org/ledgers?order=desc&limit=3",
  );
});

test("maps 404 to NotFoundError instead of a provider failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(404, '{"title":"Resource Missing"}')),
  );

  await expect(
    horizonGet("testnet", "/accounts/GMISSING"),
  ).rejects.toBeInstanceOf(NotFoundError);
});

test("fails over to the second horizon on 500", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(response(500))
    .mockResolvedValueOnce(response(200, '{"_embedded":{"records":[]}}'));
  vi.stubGlobal("fetch", fetchMock);

  const page = await fetchLatestLedgers("mainnet", 1);

  expect(page._embedded.records).toEqual([]);
  expect(String(fetchMock.mock.calls[1][0])).toContain(
    "horizon.stellar.lobstr.co",
  );
});

test("maps other non-ok statuses to UpstreamError with the status", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(400, '{"title":"Bad Request"}')),
  );

  const failure = await horizonGet("testnet", "/ledgers").catch(
    (error) => error,
  );

  expect(failure).toBeInstanceOf(UpstreamError);
  expect((failure as UpstreamError).status).toBe(400);
});

const VALID_TX = {
  hash: "beef".repeat(16),
  paging_token: "1",
  successful: true,
  source_account: "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI",
  source_account_sequence: "203069091936010245",
  created_at: "2026-08-24T10:00:00Z",
  fee_charged: "200",
  max_fee: "1000",
  memo_type: "none",
  operation_count: 1,
  ledger: 64000123,
};

test("returns a well-formed transaction unchanged", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(200, JSON.stringify(VALID_TX))),
  );

  const tx = await fetchTransaction("testnet", VALID_TX.hash);

  expect(tx.hash).toBe(VALID_TX.hash);
  expect(tx.operation_count).toBe(1);
});

test("rejects a transaction body missing the fields the page renders", async () => {
  for (const body of [
    "{}",
    '{"_embedded":{"records":[]}}',
    "null",
    JSON.stringify({ ...VALID_TX, hash: 42 }),
    JSON.stringify({ ...VALID_TX, successful: "yes" }),
    JSON.stringify({ ...VALID_TX, fee_charged: null }),
    JSON.stringify({ ...VALID_TX, operation_count: "1" }),
  ]) {
    resetFailoverState();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(200, body)),
    );

    const failure = await fetchTransaction("testnet", VALID_TX.hash).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(UpstreamError);
    expect(String(failure)).toMatch(/malformed/);
  }
});

test("rejects a ledger body that would reach the page as a non-string hash", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(200, '{"sequence":1,"closed_at":"x"}')),
  );

  const failure = await fetchLedger("testnet", "1").catch(
    (error: unknown) => error,
  );

  expect(failure).toBeInstanceOf(UpstreamError);
  expect(String(failure)).toMatch(/malformed/);
});

const ACCOUNT_BODY = JSON.stringify({
  id: "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI",
  account_id: "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI",
  sequence: "203069091936010245",
  subentry_count: 2,
  last_modified_ledger: 64000123,
  balances: [{ balance: "12.5000000", asset_type: "native" }],
  signers: [
    {
      key: "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI",
      weight: 1,
      type: "ed25519_public_key",
    },
  ],
  thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
  flags: {
    auth_required: false,
    auth_revocable: false,
    auth_immutable: false,
    auth_clawback_enabled: false,
  },
});

test("an account keeps its int64 fields as strings", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(200, ACCOUNT_BODY)),
  );

  const account = await fetchAccount("testnet", "GADQ");

  expect(account.sequence).toBe("203069091936010245");
  expect(account.balances[0].balance).toBe("12.5000000");
});

test("a body of the wrong shape is an upstream error, not an account", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(200, '{"account_id":"GADQ"}')),
  );

  await expect(fetchAccount("testnet", "GADQ")).rejects.toBeInstanceOf(
    UpstreamError,
  );
});

test("account history pages from a cursor and keeps failed operations", async () => {
  const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) =>
    response(200, '{"_embedded":{"records":[]}}'),
  );
  vi.stubGlobal("fetch", fetchMock);

  await fetchAccountOperations("testnet", "GADQ", 20, "275000000000000000");

  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://horizon-testnet.stellar.org/accounts/GADQ/operations" +
      "?order=desc&limit=20&include_failed=true&join=transactions" +
      "&cursor=275000000000000000",
  );
});

test("the first page of history asks for no cursor at all", async () => {
  const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) =>
    response(200, '{"_embedded":{"records":[]}}'),
  );
  vi.stubGlobal("fetch", fetchMock);

  await fetchAccountOperations("testnet", "GADQ", 20);

  expect(fetchMock.mock.calls[0][0]).not.toContain("cursor");
});

test("the meta comes from whichever provider still keeps one", async () => {
  // SDF's Horizon runs with transaction meta off, so the first answer is a
  // valid transaction with no meta in it; the next provider has it
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(response(200, '{"hash":"abc"}'))
    .mockResolvedValueOnce(
      response(200, '{"hash":"abc","result_meta_xdr":"AAAA"}'),
    );
  vi.stubGlobal("fetch", fetchMock);

  await expect(fetchTransactionMeta("mainnet", "abc")).resolves.toBe("AAAA");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("no provider keeping a meta resolves to nothing, not an error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(200, '{"hash":"abc"}')),
  );

  await expect(fetchTransactionMeta("mainnet", "abc")).resolves.toBeUndefined();
});

test("an unreachable provider is skipped rather than failing the lookup", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error("network down"))
    .mockResolvedValueOnce(
      response(200, '{"hash":"abc","result_meta_xdr":"AAAA"}'),
    );
  vi.stubGlobal("fetch", fetchMock);

  await expect(fetchTransactionMeta("mainnet", "abc")).resolves.toBe("AAAA");
});
