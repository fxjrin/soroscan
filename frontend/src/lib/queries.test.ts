import { expect, test } from "vitest";
import { nextHealthPollDelay } from "./queries";

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
