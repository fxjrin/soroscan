import { expect, test } from "vitest";
import { averageCloseSeconds, mergeRecords } from "./live";

interface Item {
  key: string;
}

const keyOf = (item: Item) => item.key;

test("mergeRecords prepends incoming, dedupes by key, and caps the list", () => {
  const existing = [{ key: "c" }, { key: "b" }, { key: "a" }];
  const incoming = [{ key: "d" }, { key: "c" }];

  const merged = mergeRecords(existing, incoming, keyOf, 3);

  expect(merged.map(keyOf)).toEqual(["d", "c", "b"]);
});

test("mergeRecords returns the existing list untouched for empty input", () => {
  const existing = [{ key: "a" }];

  expect(mergeRecords(existing, [], keyOf, 5)).toBe(existing);
});

test("averageCloseSeconds averages consecutive close-time gaps", () => {
  const closedAts = [
    "2026-08-23T19:30:10Z",
    "2026-08-23T19:30:05Z",
    "2026-08-23T19:29:59Z",
  ];

  expect(averageCloseSeconds(closedAts)).toBe(5.5);
  expect(averageCloseSeconds(["2026-08-23T19:30:10Z"])).toBeUndefined();
});

test("mergeRecords drops duplicate keys inside one incoming batch", () => {
  const incoming = [
    { paging_token: "3" },
    { paging_token: "3" },
    { paging_token: "2" },
  ];

  const merged = mergeRecords(
    [{ paging_token: "1" }],
    incoming,
    (record) => record.paging_token,
    5,
  );

  expect(merged.map((record) => record.paging_token)).toEqual(["3", "2", "1"]);
});
