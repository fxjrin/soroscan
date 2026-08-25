import { expect, test } from "vitest";
import {
  bigIntTo128Parts,
  ExtensionPoint,
  Int128Parts,
  ScVal,
  SorobanTransactionMeta,
  SorobanTransactionMetaExt,
  SorobanTransactionMetaV2,
  TransactionMeta,
  TransactionMetaV3,
  TransactionMetaV4,
} from "@stellar/stellar-sdk/xdr";
import { decodeReturnValue } from "./tx-meta";

function v3Meta(returnValue: ScVal): string {
  return TransactionMeta.v3(
    new TransactionMetaV3({
      ext: ExtensionPoint.v0(),
      txChangesBefore: [],
      operations: [],
      txChangesAfter: [],
      sorobanMeta: new SorobanTransactionMeta({
        ext: SorobanTransactionMetaExt.v0(),
        events: [],
        returnValue,
        diagnosticEvents: [],
      }),
    }),
  ).toXdr("base64");
}

function v4Meta(returnValue: ScVal): string {
  return TransactionMeta.v4(
    new TransactionMetaV4({
      ext: ExtensionPoint.v0(),
      txChangesBefore: [],
      operations: [],
      txChangesAfter: [],
      sorobanMeta: new SorobanTransactionMetaV2({
        ext: SorobanTransactionMetaExt.v0(),
        returnValue,
      }),
      events: [],
      diagnosticEvents: [],
    }),
  ).toXdr("base64");
}

test("extracts the return value from a v3 meta", async () => {
  const meta = v3Meta(
    ScVal.scvI128(new Int128Parts(bigIntTo128Parts(4784129n, true))),
  );
  await expect(decodeReturnValue(meta)).resolves.toEqual({
    kind: "text",
    type: "i128",
    text: "4784129",
  });
});

test("extracts the return value from a v4 meta", async () => {
  const meta = v4Meta(ScVal.scvU32(7));
  await expect(decodeReturnValue(meta)).resolves.toEqual({
    kind: "text",
    type: "u32",
    text: "7",
  });
});

test("a classic meta has no return value", async () => {
  const meta = TransactionMeta.operations([]).toXdr("base64");
  await expect(decodeReturnValue(meta)).resolves.toBeUndefined();
});

test("a v3 meta without soroban data has no return value", async () => {
  const meta = TransactionMeta.v3(
    new TransactionMetaV3({
      ext: ExtensionPoint.v0(),
      txChangesBefore: [],
      operations: [],
      txChangesAfter: [],
      sorobanMeta: null,
    }),
  ).toXdr("base64");
  await expect(decodeReturnValue(meta)).resolves.toBeUndefined();
});

test("garbage input decodes to nothing instead of throwing", async () => {
  await expect(decodeReturnValue("AAAA")).resolves.toBeUndefined();
  await expect(decodeReturnValue("not base64!!!")).resolves.toBeUndefined();
});
