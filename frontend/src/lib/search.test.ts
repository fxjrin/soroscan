import { expect, test } from "vitest";
import { classifySearch, searchTargetPath } from "./search";

const G = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const M =
  "MABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDANXR2";
const C = "CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L";
const HASH = "A2B4C6D8E0A2B4C6D8E0A2B4C6D8E0A2B4C6D8E0A2B4C6D8E0A2B4C6D8E0A2B4";

test("classifies account, muxed, and contract strkeys", () => {
  expect(classifySearch(G)).toEqual({ type: "account", value: G });
  expect(classifySearch(M)).toEqual({ type: "account", value: M });
  expect(classifySearch(C)).toEqual({ type: "contract", value: C });
});

test("classifies transaction hashes case-insensitively and ledgers numerically", () => {
  expect(classifySearch(HASH)).toEqual({
    type: "tx",
    value: HASH.toLowerCase(),
  });
  expect(classifySearch("64090000")).toEqual({
    type: "ledger",
    value: "64090000",
  });
});

test("trims whitespace before classifying", () => {
  expect(classifySearch(`  ${G}  `)).toEqual({ type: "account", value: G });
});

test("rejects lookalikes and garbage", () => {
  expect(classifySearch(G.slice(0, -1) + "A").type).toBe("unknown");
  expect(classifySearch(G.toLowerCase()).type).toBe("unknown");
  expect(classifySearch("hello world").type).toBe("unknown");
  expect(classifySearch("").type).toBe("unknown");
});

test("maps targets to routes", () => {
  expect(searchTargetPath({ type: "tx", value: "ab" })).toBe("/tx/ab");
  expect(searchTargetPath({ type: "ledger", value: "5" })).toBe("/ledger/5");
  expect(searchTargetPath({ type: "unknown", value: "x" })).toBeNull();
});
