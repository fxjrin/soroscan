import { expect, test } from "vitest";
import { groupByTransaction } from "./history";
import type { OperationRecord } from "./horizon/client";

function op(hash: string, token: string, type = "payment"): OperationRecord {
  return {
    id: token,
    paging_token: token,
    transaction_hash: hash,
    type,
    source_account: "GADQ",
  };
}

test("operations of one transaction become one entry", () => {
  const entries = groupByTransaction([
    op("aaa", "3"),
    op("aaa", "2"),
    op("aaa", "1"),
  ]);

  expect(entries).toHaveLength(1);
  expect(entries[0].hash).toBe("aaa");
  expect(entries[0].operations).toHaveLength(3);
});

test("the entry carries the token of its last operation", () => {
  const entries = groupByTransaction([op("aaa", "3"), op("aaa", "2")]);

  // the next page continues from where this group ended, not where it began
  expect(entries[0].lastToken).toBe("2");
});

test("a new hash starts a new entry", () => {
  const entries = groupByTransaction([
    op("aaa", "4"),
    op("bbb", "3"),
    op("bbb", "2"),
    op("ccc", "1"),
  ]);

  expect(entries.map((entry) => entry.hash)).toEqual(["aaa", "bbb", "ccc"]);
  expect(entries.map((entry) => entry.operations.length)).toEqual([1, 2, 1]);
});

test("a hash that comes back later is a separate entry, not a merge", () => {
  // the same transaction cannot reappear out of order, and merging distant
  // runs would silently reorder the page
  const entries = groupByTransaction([
    op("aaa", "3"),
    op("bbb", "2"),
    op("aaa", "1"),
  ]);

  expect(entries).toHaveLength(3);
});

test("an empty page groups into nothing", () => {
  expect(groupByTransaction([])).toEqual([]);
});
