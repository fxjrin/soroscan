import { afterEach, expect, test, vi } from "vitest";
import { fetchArchivedMeta, lakeObjectKey } from "./ledger-lake";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a ledger sits in the partition its sequence falls into", () => {
  // the archive names both partition and file by the complement of the
  // sequence, so listings run newest first
  expect(lakeObjectKey(63731687)).toBe(
    "FC3451FF--63680000-63743999/FC338818--63731687.xdr.zst",
  );
});

test("the first ledger of a partition opens it", () => {
  expect(lakeObjectKey(63680000)).toBe(
    "FC3451FF--63680000-63743999/FC3451FF--63680000.xdr.zst",
  );
});

test("the last ledger of a partition still belongs to it", () => {
  expect(lakeObjectKey(63743999)).toBe(
    "FC3451FF--63680000-63743999/FC335800--63743999.xdr.zst",
  );
});

test("only the public network is archived under this program", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    fetchArchivedMeta("testnet", 63731687, "ab"),
  ).resolves.toBeUndefined();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a ledger the archive does not have resolves to nothing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 404 })),
  );

  await expect(
    fetchArchivedMeta("mainnet", 63731687, "ab"),
  ).resolves.toBeUndefined();
});

test("a sequence that is not a whole number never reaches the network", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    fetchArchivedMeta("mainnet", Number.NaN, "ab"),
  ).resolves.toBeUndefined();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("the meta of the asked-for transaction is picked out of the ledger", async () => {
  const { batch, hash, meta } = await import("./ledger-lake.fixture");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(batch.slice().buffer)),
  );

  await expect(fetchArchivedMeta("mainnet", 100, hash)).resolves.toBe(meta);
});

test("a ledger without the transaction it was asked for resolves to nothing", async () => {
  const { batch } = await import("./ledger-lake.fixture");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(batch.slice().buffer)),
  );

  await expect(
    fetchArchivedMeta("mainnet", 100, "ff".repeat(32)),
  ).resolves.toBeUndefined();
});

test("an unreachable archive costs the caller nothing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network down");
    }),
  );

  await expect(
    fetchArchivedMeta("mainnet", 100, "ab"),
  ).resolves.toBeUndefined();
});

test("bytes the archive cannot have written resolve to nothing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from([1, 2, 3]).buffer)),
  );

  await expect(
    fetchArchivedMeta("mainnet", 100, "ab"),
  ).resolves.toBeUndefined();
});
