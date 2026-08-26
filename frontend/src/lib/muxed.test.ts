import { expect, test } from "vitest";
import { resolveMuxed } from "./muxed";

const BASE = "GAYHQPWHOWUQUJLUJA3JZB73M5JJZPP7MIFCQYONED7VROGGPFGL6HJ6";
const MUXED =
  "MAYHQPWHOWUQUJLUJA3JZB73M5JJZPP7MIFCQYONED7VROGGPFGL6AAAAAAAAAAE2KAOA";

test("a muxed address names the account the ledger knows", () => {
  expect(resolveMuxed(MUXED)).toEqual({ base: BASE, id: "1234" });
});

test("a plain account is not muxed", () => {
  expect(resolveMuxed(BASE)).toBeUndefined();
});

test("a contract address is not muxed", () => {
  expect(
    resolveMuxed("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"),
  ).toBeUndefined();
});

test("nonsense is not muxed", () => {
  expect(resolveMuxed("not-an-address")).toBeUndefined();
  expect(resolveMuxed("")).toBeUndefined();
});

test("an id past 2^53 survives, where a JS number would not", () => {
  // the id is a u64; the largest one is well past what a float can hold
  const huge =
    "MAYHQPWHOWUQUJLUJA3JZB73M5JJZPP7MIFCQYONED7VROGGPFGL77777777777776NGC";

  expect(resolveMuxed(huge)?.id).toBe("18446744073709551615");
});
