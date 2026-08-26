import { expect, test } from "vitest";
import { nextHealthPollDelay, txSorobanQuery } from "./queries";

const NOW = 1_756_000_000_000;

test("aims the poll at the expected detection moment", () => {
  const closedSec = (NOW - 2000) / 1000;

  expect(nextHealthPollDelay(closedSec, NOW)).toBe(5500);
});

test("bursts at the floor while a ledger is overdue", () => {
  const closedSec = (NOW - 12_000) / 1000;

  expect(nextHealthPollDelay(closedSec, NOW)).toBe(500);
});

test("clamps far-future and garbage inputs", () => {
  expect(nextHealthPollDelay((NOW + 60_000) / 1000, NOW)).toBe(8000);
  expect(nextHealthPollDelay(Number.NaN, NOW)).toBe(2500);
});

test("a trace fetched without the envelope is cached apart from one with it", () => {
  // the envelope is what lets a trace fall back to the authorization
  // entries when the meta has aged out of retention; a caller that has no
  // envelope must not answer for one that does
  const withEnvelope = txSorobanQuery("mainnet", "abc", {
    envelopeXdr: "AAAA",
  });
  const without = txSorobanQuery("mainnet", "abc");

  expect(withEnvelope.queryKey).not.toEqual(without.queryKey);
});

test("the same envelope reaches the same cache entry", () => {
  expect(
    txSorobanQuery("mainnet", "abc", { envelopeXdr: "AAAA" }).queryKey,
  ).toEqual(txSorobanQuery("mainnet", "abc", { envelopeXdr: "BBBB" }).queryKey);
});

test("a trace that can reach the archive is cached apart from one that cannot", () => {
  // the archive is the only source with diagnostic events for an old
  // transaction, so an answer found without it must not stand in for one
  expect(
    txSorobanQuery("mainnet", "abc", { ledger: 100 }).queryKey,
  ).not.toEqual(txSorobanQuery("mainnet", "abc").queryKey);
});
