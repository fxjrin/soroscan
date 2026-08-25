import { expect, test } from "vitest";
import {
  bigIntTo128Parts,
  bigIntTo256Parts,
  ClaimableBalanceId,
  ContractExecutable,
  Int128Parts,
  Int256Parts,
  MuxedEd25519Account,
  PoolId,
  ScAddress,
  ScContractInstance,
  ScError,
  ScMapEntry,
  ScVal,
  Uint128Parts,
  Uint256Parts,
} from "@stellar/stellar-sdk/xdr";
import { decodeScAddress, decodeScSymbol, decodeScVal } from "./scval";

const C1 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const G1 = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const M1 =
  "MADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOAAAAAAAAAAAAG4HM";
const B1 = "BAAAOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOB4RVQ";
const L1 = "LADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQPEA4";
const CONTRACT_SCVAL =
  "AAAAEgAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQ==";
const ACCOUNT_SCVAL =
  "AAAAEgAAAAAAAAAABwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const TRANSFER_SCVAL = "AAAADwAAAAh0cmFuc2Zlcg==";

const SEVENS = new Uint8Array(32).fill(7);

function b64(value: ScVal): string {
  return value.toXdr("base64");
}

// the sdk stringifies via the global TextEncoder, whose output fails the
// sdk's own instanceof check under jsdom; raw bytes sidestep that
function ascii(value: string): Uint8Array {
  return Uint8Array.from(value, (char) => char.charCodeAt(0));
}

test("decodes a contract address scval to its strkey", () => {
  expect(decodeScAddress(CONTRACT_SCVAL)).toBe(C1);
});

test("decodes an account address scval to its strkey", () => {
  expect(decodeScAddress(ACCOUNT_SCVAL)).toBe(G1);
});

test("rejects non-address scvals and garbage", () => {
  expect(decodeScAddress(TRANSFER_SCVAL)).toBeUndefined();
  expect(decodeScAddress("AAAA")).toBeUndefined();
  expect(decodeScAddress("not base64!!!")).toBeUndefined();
});

test("decodes a symbol scval", () => {
  expect(decodeScSymbol(TRANSFER_SCVAL)).toBe("transfer");
});

test("rejects non-symbol scvals, oversize, empty, and hostile characters", () => {
  expect(decodeScSymbol(CONTRACT_SCVAL)).toBeUndefined();
  expect(decodeScSymbol("AAAADwAAAGF4")).toBeUndefined();
  expect(decodeScSymbol("AAAADwAAAAJhLg==")).toBeUndefined();
  expect(decodeScSymbol(b64(ScVal.scvSymbol(ascii(""))))).toBeUndefined();
});

test("decodes the cap-67 address kinds to their strkeys", () => {
  const muxed = ScAddress.scAddressTypeMuxedAccount(
    new MuxedEd25519Account({ id: 1n, ed25519: SEVENS }),
  );
  expect(decodeScAddress(b64(ScVal.scvAddress(muxed)))).toBe(M1);
  const claimable = ScAddress.scAddressTypeClaimableBalance(
    ClaimableBalanceId.claimableBalanceIdTypeV0(SEVENS),
  );
  expect(decodeScAddress(b64(ScVal.scvAddress(claimable)))).toBe(B1);
  const pool = ScAddress.scAddressTypeLiquidityPool(new PoolId(SEVENS));
  expect(decodeScAddress(b64(ScVal.scvAddress(pool)))).toBe(L1);
});

test("decodes every numeric type to a decimal string", () => {
  expect(decodeScVal(b64(ScVal.scvU32(178651)))).toEqual({
    kind: "text",
    type: "u32",
    text: "178651",
  });
  expect(decodeScVal(b64(ScVal.scvI32(-5)))).toMatchObject({ text: "-5" });
  expect(decodeScVal(b64(ScVal.scvU64(18446744073709551615n)))).toEqual({
    kind: "text",
    type: "u64",
    text: "18446744073709551615",
  });
  expect(decodeScVal(b64(ScVal.scvI64(-2n)))).toMatchObject({ text: "-2" });
  expect(
    decodeScVal(
      b64(ScVal.scvU128(new Uint128Parts(bigIntTo128Parts(2n ** 100n, false)))),
    ),
  ).toEqual({ kind: "text", type: "u128", text: (2n ** 100n).toString() });
  expect(
    decodeScVal(
      b64(
        ScVal.scvI128(new Int128Parts(bigIntTo128Parts(-(2n ** 127n), true))),
      ),
    ),
  ).toEqual({ kind: "text", type: "i128", text: (-(2n ** 127n)).toString() });
  expect(
    decodeScVal(
      b64(ScVal.scvU256(new Uint256Parts(bigIntTo256Parts(2n ** 200n, false)))),
    ),
  ).toMatchObject({ type: "u256", text: (2n ** 200n).toString() });
  expect(
    decodeScVal(
      b64(
        ScVal.scvI256(new Int256Parts(bigIntTo256Parts(-(2n ** 255n), true))),
      ),
    ),
  ).toMatchObject({ type: "i256", text: (-(2n ** 255n)).toString() });
  expect(decodeScVal(b64(ScVal.scvTimepoint(1724500000n)))).toEqual({
    kind: "text",
    type: "time",
    text: "1724500000",
  });
  expect(decodeScVal(b64(ScVal.scvDuration(60n)))).toMatchObject({
    type: "dur",
  });
});

test("decodes bool, void, string, and bytes", () => {
  expect(decodeScVal(b64(ScVal.scvBool(true)))).toMatchObject({
    text: "true",
  });
  expect(decodeScVal(b64(ScVal.scvBool(false)))).toMatchObject({
    text: "false",
  });
  expect(decodeScVal(b64(ScVal.scvVoid()))).toMatchObject({ type: "void" });
  expect(decodeScVal(b64(ScVal.scvString(ascii("hello world"))))).toEqual({
    kind: "text",
    type: "str",
    text: "hello world",
  });
  expect(
    decodeScVal(b64(ScVal.scvBytes(new Uint8Array([0xde, 0xad, 0xbe, 0xef])))),
  ).toEqual({ kind: "text", type: "bytes", text: "0xdeadbeef" });
});

test("caps oversized strings and bytes for display", () => {
  expect(
    decodeScVal(b64(ScVal.scvString(ascii("a".repeat(300))))),
  ).toMatchObject({
    text: "a".repeat(120) + "...",
  });
  expect(
    decodeScVal(b64(ScVal.scvBytes(new Uint8Array(64).fill(7)))),
  ).toMatchObject({
    text: "0x" + "07".repeat(16) + "..." + "07".repeat(16),
  });
});

test("decodes vectors and maps recursively", () => {
  const vec = decodeScVal(
    b64(ScVal.scvVec([ScVal.scvU32(1), ScVal.scvSymbol(ascii("a"))])),
  );
  expect(vec).toEqual({
    kind: "vec",
    type: "vec",
    items: [
      { kind: "text", type: "u32", text: "1" },
      { kind: "text", type: "sym", text: "a" },
    ],
  });
  const map = decodeScVal(
    b64(
      ScVal.scvMap([
        new ScMapEntry({
          key: ScVal.scvSymbol(ascii("k")),
          val: ScVal.scvU32(9),
        }),
      ]),
    ),
  );
  expect(map).toEqual({
    kind: "map",
    type: "map",
    entries: [
      {
        key: { kind: "text", type: "sym", text: "k" },
        value: { kind: "text", type: "u32", text: "9" },
      },
    ],
  });
});

test("decodes errors and reduces exotic values to their type", () => {
  expect(decodeScVal(b64(ScVal.scvError(ScError.sceContract(5))))).toEqual({
    kind: "text",
    type: "err",
    text: "contract error #5",
  });
  const instance = ScVal.scvContractInstance(
    new ScContractInstance({
      executable: ContractExecutable.contractExecutableStellarAsset(),
      storage: null,
    }),
  );
  expect(decodeScVal(b64(instance))).toEqual({
    kind: "opaque",
    type: "contract instance",
  });
  expect(decodeScVal(b64(ScVal.scvLedgerKeyContractInstance()))).toEqual({
    kind: "opaque",
    type: "ledger key",
  });
});

test("rejects unknown types, truncation, hostile counts, and deep nesting", () => {
  expect(decodeScVal("AAAAYw==")).toBeUndefined(); // unknown discriminant 99
  expect(decodeScVal("AAAABQAAAAA=")).toBeUndefined(); // u64 with 4 bytes
  expect(decodeScVal("AAAAEAAAAAH/////")).toBeUndefined(); // vec claims 2^32-1 items
  let bomb: ScVal = ScVal.scvU32(1);
  for (let i = 0; i < 12; i++) {
    bomb = ScVal.scvVec([bomb]);
  }
  expect(decodeScVal(b64(bomb))).toBeUndefined();
});
