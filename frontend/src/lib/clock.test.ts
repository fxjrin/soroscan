import { beforeEach, expect, test } from "vitest";
import { chainNow, recordClockSample, resetClock } from "./clock";

beforeEach(() => {
  resetClock();
});

function headerAt(offsetFromNowMs: number): string {
  return new Date(Date.now() + offsetFromNowMs).toUTCString();
}

test("first sample sets the offset outright", () => {
  recordClockSample(headerAt(3000), 200);

  const offset = chainNow() - Date.now();
  expect(offset).toBeGreaterThan(1500);
  expect(offset).toBeLessThan(5500);
});

test("later samples move the offset gradually, not jumpily", () => {
  recordClockSample(headerAt(0), 0);
  const before = chainNow() - Date.now();

  recordClockSample(headerAt(10_000), 0);
  const after = chainNow() - Date.now();

  expect(after - before).toBeGreaterThan(1000);
  expect(after - before).toBeLessThan(4000);
});

test("implausible skew and garbage headers are ignored", () => {
  recordClockSample(headerAt(10 * 60 * 1000), 0);
  recordClockSample("not a date", 0);

  expect(Math.abs(chainNow() - Date.now())).toBeLessThan(50);
});
