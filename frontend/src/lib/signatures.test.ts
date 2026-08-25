import { expect, test } from "vitest";
import {
  Asset,
  DecoratedSignature as XdrDecoratedSignature,
  Memo,
  MuxedAccount,
  Operation,
  OperationBody,
  PaymentOp,
  Preconditions,
  Transaction,
  TransactionEnvelope,
  TransactionExt,
  TransactionV1Envelope,
} from "@stellar/stellar-sdk/xdr";
import { StrKey } from "@stellar/stellar-sdk/base";
import { addressHint, extractSignatureHints } from "./signatures";

const G1 = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function envelopeOf(decorated: XdrDecoratedSignature[]): string {
  const tx = new Transaction({
    sourceAccount: MuxedAccount.keyTypeEd25519(new Uint8Array(32).fill(7)),
    fee: 100,
    seqNum: 1n,
    cond: Preconditions.precondNone(),
    memo: Memo.memoNone(),
    operations: [
      new Operation({
        sourceAccount: null,
        body: OperationBody.payment(
          new PaymentOp({
            destination: MuxedAccount.keyTypeEd25519(
              new Uint8Array(32).fill(9),
            ),
            asset: Asset.assetTypeNative(),
            amount: 10n,
          }),
        ),
      }),
    ],
    ext: TransactionExt.v0(),
  });
  return TransactionEnvelope.envelopeTypeTx(
    new TransactionV1Envelope({ tx, signatures: decorated }),
  ).toXdr("base64");
}

test("recovers hints from the envelope tail and verifies each signature", () => {
  const sigA = new Uint8Array(64).fill(1);
  const sigB = new Uint8Array(64).fill(2);
  const envelope = envelopeOf([
    new XdrDecoratedSignature({
      hint: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      signature: sigA,
    }),
    new XdrDecoratedSignature({
      hint: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
      signature: sigB,
    }),
  ]);
  const hints = extractSignatureHints(envelope, [
    toBase64(sigA),
    toBase64(sigB),
  ]);
  expect(hints).toEqual([
    { hint: "deadbeef", signature: toBase64(sigA) },
    { hint: "01020304", signature: toBase64(sigB) },
  ]);
});

test("a signature list that does not match the envelope is discarded", () => {
  const sig = new Uint8Array(64).fill(1);
  const envelope = envelopeOf([
    new XdrDecoratedSignature({
      hint: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      signature: sig,
    }),
  ]);
  const other = toBase64(new Uint8Array(64).fill(3));
  expect(extractSignatureHints(envelope, [other])).toBeUndefined();
  expect(extractSignatureHints(envelope, [])).toBeUndefined();
  expect(extractSignatureHints("garbage!!!", [toBase64(sig)])).toBeUndefined();
  expect(extractSignatureHints("AAAA", [toBase64(sig)])).toBeUndefined();
});

test("address hints come from the last 4 key bytes", () => {
  const key = StrKey.decodeEd25519PublicKey(G1);
  const expected = Array.from(key.slice(28), (byte: number) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  expect(addressHint(G1)).toBe(expected);
  expect(
    addressHint("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"),
  ).toBeUndefined();
  expect(addressHint("not an address")).toBeUndefined();
});
