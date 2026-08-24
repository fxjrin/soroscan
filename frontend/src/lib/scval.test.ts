import { expect, test } from "vitest";
import { decodeScAddress, decodeScSymbol } from "./scval";

const C1 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const G1 = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const CONTRACT_SCVAL =
  "AAAAEgAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQ==";
const ACCOUNT_SCVAL =
  "AAAAEgAAAAAAAAAABwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const TRANSFER_SCVAL = "AAAADwAAAAh0cmFuc2Zlcg==";

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

test("rejects non-symbol scvals, oversize, and hostile characters", () => {
  expect(decodeScSymbol(CONTRACT_SCVAL)).toBeUndefined();
  expect(decodeScSymbol("AAAADwAAAGF4")).toBeUndefined();
  expect(decodeScSymbol("AAAADwAAAAJhLg==")).toBeUndefined();
});

function scvalOf(kind: number, payloadLength: number): string {
  const bytes = [0, 0, 0, 18, 0, 0, 0, kind];
  for (let i = 0; i < payloadLength; i++) {
    bytes.push(7);
  }
  return btoa(String.fromCharCode(...bytes));
}

test("muxed and other cap-67 address kinds are rejected", () => {
  expect(decodeScAddress(scvalOf(2, 40))).toBeUndefined();
  expect(decodeScAddress(scvalOf(3, 33))).toBeUndefined();
  expect(decodeScAddress(scvalOf(4, 32))).toBeUndefined();
});
