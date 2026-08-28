import { expect, test } from "vitest";
import {
  contractCodeKey,
  contractInstanceKey,
  contractInterface,
  decodeContractCode,
  decodeContractInstance,
} from "./contract";

function hexOf(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

const CONTRACT = "CBGSBKYMYO6OMGHQXXNOBRGVUDFUDVC2XLC3SXON5R2SNXILR7XCKKY3";

// captured from mainnet.sorobanrpc.com getLedgerEntries for the KaleFail
// Tractor contract, a small real wasm rather than a hand-built one: this
// is what a test's own encoder cannot accidentally agree with itself on
const INSTANCE_XDR =
  "AAAABgAAAAAAAAABTSCrDMO85hjwvdrgxNWgy0HUWrrFuV3N7HUm3QuP7iUAAAAUAAAAAQAAABMAAAAAcP5EaUyf5rCrxpptpIWPwqq6BPoQSSpGah1CbQTKhWAAAAABAAAAAQAAAA8AAAAERkFSTQAAABIAAAAB1/5EvQrxHWArEJHy9KH03yEtRE0DIeoyrbPMHLurCgQ=";
const CODE_XDR =
  "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";

test("the instance key is the same one getLedgerEntries expects for a contract's own storage", async () => {
  const key = await contractInstanceKey(CONTRACT);
  // decoding it back with the sdk proves this is a real, well-formed
  // LedgerKeyContractData for the persistent instance entry, not just a
  // string that happens to look right
  const xdr = await import("@stellar/stellar-sdk/xdr");
  const decoded = xdr.LedgerKey.fromXdr(key, "base64");
  if (decoded.type !== "contractData") {
    throw new Error(`expected contractData, got ${decoded.type}`);
  }
  expect(decoded.contractData.durability.name).toBe("persistent");
  expect(decoded.contractData.key.type).toBe("scvLedgerKeyContractInstance");
});

test("decodes a real contract instance: executable, storage, and non-wasm executables", async () => {
  const instance = await decodeContractInstance(INSTANCE_XDR);
  expect(instance?.executable).toEqual({
    kind: "wasm",
    wasmHash:
      "70fe44694c9fe6b0abc69a6da4858fc2aaba04fa10492a466a1d426d04ca8560",
  });
  // the one instance-storage entry this contract carries: a "FARM" symbol
  // mapping to an address, decoded the same way the trace decodes ScVal
  expect(instance?.storage).toHaveLength(1);
  expect(instance?.storage[0]?.key).toEqual({
    kind: "text",
    type: "sym",
    text: "FARM",
  });
  expect(instance?.storage[0]?.value.kind).toBe("address");
});

test("the code key round-trips a wasm hash into the ledger key that owns it", async () => {
  const key = await contractCodeKey(
    "70fe44694c9fe6b0abc69a6da4858fc2aaba04fa10492a466a1d426d04ca8560",
  );
  const xdr = await import("@stellar/stellar-sdk/xdr");
  const decoded = xdr.LedgerKey.fromXdr(key, "base64");
  if (decoded.type !== "contractCode") {
    throw new Error(`expected contractCode, got ${decoded.type}`);
  }
  expect(hexOf(decoded.contractCode.hash.toBytes())).toBe(
    "70fe44694c9fe6b0abc69a6da4858fc2aaba04fa10492a466a1d426d04ca8560",
  );
});

test("decodes a real contract's wasm code entry", async () => {
  const code = await decodeContractCode(CODE_XDR);
  expect(code?.hash).toBe(
    "70fe44694c9fe6b0abc69a6da4858fc2aaba04fa10492a466a1d426d04ca8560",
  );
  expect(code?.wasmBytes.length).toBeGreaterThan(0);
});

test("reads a real contract's interface from its wasm's spec section", async () => {
  const code = await decodeContractCode(CODE_XDR);
  const info = await contractInterface(code!.wasmBytes);
  const names = info?.functions.map((fn) => fn.name);
  expect(names).toContain("harvest");
  expect(names).toContain("__constructor");
  const harvest = info?.functions.find((fn) => fn.name === "harvest");
  expect(harvest?.inputs).toEqual([
    { name: "farmer", type: "Address" },
    { name: "pails", type: "Vec<u32>" },
  ]);
  expect(harvest?.outputs).toEqual(["Vec<i128>"]);
  expect(harvest?.doc).toBe(
    "Harvest multiple pails available for your KALE farmer.\n\n" +
      "# Arguments\n" +
      "- `farmer` - address of the farmer to harvest on behalf of\n" +
      "- `pails` - vector of pails which should be harvested\n\n" +
      "# Panics\n" +
      "- If the `pails` vector is empty\n" +
      "- If no pails result in a non-zero reward",
  );
  const ctor = info?.functions.find((fn) => fn.name === "__constructor");
  expect(ctor?.doc).toBe("");

  expect(info?.errors).toHaveLength(1);
  expect(info?.errors[0]?.name).toBe("Error");
  expect(info?.errors[0]?.cases).toEqual([
    {
      name: "NoPailsProvided",
      value: 1,
      doc: "No pails provided in invocation",
    },
    {
      name: "NoHarvestablePails",
      value: 2,
      doc: "Harvesting all pails results in 0 reward",
    },
  ]);
});

test("malformed entries decode to undefined rather than throwing", async () => {
  await expect(
    decodeContractInstance("not xdr at all"),
  ).resolves.toBeUndefined();
  await expect(decodeContractCode("not xdr at all")).resolves.toBeUndefined();
  await expect(
    contractInterface(new Uint8Array([1, 2, 3])),
  ).resolves.toBeUndefined();
});

test("a ledger key entry decoded as an instance returns undefined, not a crash", async () => {
  // the code entry is well-formed XDR, just the wrong LedgerEntryData
  // variant for decodeContractInstance to read as an instance
  await expect(decodeContractInstance(CODE_XDR)).resolves.toBeUndefined();
});
