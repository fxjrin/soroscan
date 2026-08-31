import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  fetchAssetMeta,
  fetchContractTransactions,
  indexerAvailable,
  INDEXER_PAGE,
} from "./client";
import { resetFailoverState } from "@/lib/failover";

const CONTRACT = "CDWMA5P5CYR7JNUGTQVETOCSJZWSGNLEILF7JMBF3QIV5BKKVGDKKI4G";

beforeEach(() => {
  resetFailoverState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubIndexer(status: number, body: object) {
  const fetchMock = vi.fn(async (_url: unknown) => {
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const WIRE_TRANSACTION = {
  tx_hash: "9e406310c1158642e61a77515d15315266962df785139d1842d16535668e6c0a",
  ledger: 62858188,
  closed_at: "2026-06-03T04:59:27Z",
  function: "cm_marked",
  args: ["GC6W52VIANBUNTGVW4AHRSIOZRUYBSHKVLSUJULMA6TUGU6TBMUOKICV", "1"],
  fee_charged: "5577830576",
};

test("indexes exist for mainnet only", () => {
  expect(indexerAvailable("mainnet")).toBe(true);
  expect(indexerAvailable("testnet")).toBe(false);
});

test("requests the first page and maps the wire shape", async () => {
  const fetchMock = stubIndexer(200, {
    transactions: [WIRE_TRANSACTION],
    next_cursor: "62858187-" + "0f".repeat(32),
  });

  const page = await fetchContractTransactions("mainnet", CONTRACT);

  const url = String(fetchMock.mock.calls[0][0]);
  expect(url).toContain(`/contracts/${CONTRACT}/transactions`);
  expect(url).toContain(`limit=${INDEXER_PAGE}`);
  expect(url).not.toContain("cursor");
  expect(page.transactions).toEqual([
    {
      txHash: WIRE_TRANSACTION.tx_hash,
      ledger: 62858188,
      closedAt: "2026-06-03T04:59:27Z",
      functionName: "cm_marked",
      args: WIRE_TRANSACTION.args,
      feeCharged: "5577830576",
    },
  ]);
  expect(page.nextCursor).toBe("62858187-" + "0f".repeat(32));
});

test("passes the cursor through and ends paging without one", async () => {
  const fetchMock = stubIndexer(200, { transactions: [] });

  const cursor = "62858187-" + "0f".repeat(32);
  const page = await fetchContractTransactions("mainnet", CONTRACT, { cursor });

  expect(String(fetchMock.mock.calls[0][0])).toContain("cursor=" + cursor);
  expect(page.transactions).toEqual([]);
  expect(page.nextCursor).toBeUndefined();
});

test("serializes the filters and leaves unset ones out", async () => {
  const fetchMock = stubIndexer(200, { transactions: [] });

  await fetchContractTransactions("mainnet", CONTRACT, {
    functionName: "work",
    from: "2026-01-01T00:00:00Z",
  });

  const url = String(fetchMock.mock.calls[0][0]);
  expect(url).toContain("function=work");
  expect(url).toContain("from=2026-01-01T00%3A00%3A00Z");
  expect(url).not.toContain("to=");
  expect(url).not.toContain("cursor");
});

test("surfaces the server's own error message", async () => {
  stubIndexer(400, { error: "invalid contract address" });

  await expect(
    fetchContractTransactions("mainnet", CONTRACT),
  ).rejects.toThrowError(/invalid contract address/);
});

test("rejects a malformed entry instead of rendering it", async () => {
  stubIndexer(200, {
    transactions: [{ ...WIRE_TRANSACTION, fee_charged: 5577830576 }],
  });

  await expect(
    fetchContractTransactions("mainnet", CONTRACT),
  ).rejects.toThrowError(/malformed entry/);
});

test("refuses to call a network with no indexer", async () => {
  await expect(
    fetchContractTransactions("testnet", CONTRACT),
  ).rejects.toThrowError(/no indexer/);
});

const ISSUER = "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA";

test("maps asset meta and treats a 404 as a plain no", async () => {
  const fetchMock = stubIndexer(200, {
    name: "Aquarius",
    description: "the aqua token",
    domain: "aqua.network",
    icon: true,
  });

  const meta = await fetchAssetMeta("mainnet", "AQUA", ISSUER);

  expect(String(fetchMock.mock.calls[0][0])).toContain(
    `/assets/AQUA/${ISSUER}/meta`,
  );
  expect(meta).toEqual({
    name: "Aquarius",
    description: "the aqua token",
    domain: "aqua.network",
    icon: true,
  });

  stubIndexer(404, { error: "no meta for this asset" });
  expect(await fetchAssetMeta("mainnet", "AQUA", ISSUER)).toBeNull();
});

test("asset meta without a domain is malformed, not partial", async () => {
  stubIndexer(200, { name: "Aquarius" });

  await expect(fetchAssetMeta("mainnet", "AQUA", ISSUER)).rejects.toThrowError(
    /malformed/,
  );
});

test("asset meta is a quiet null on a network with no indexer", async () => {
  expect(await fetchAssetMeta("testnet", "AQUA", ISSUER)).toBeNull();
});
