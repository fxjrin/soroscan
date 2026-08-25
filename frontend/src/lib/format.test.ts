import { expect, test } from "vitest";
import {
  formatAgo,
  formatAmount,
  formatDecimalDisplay,
  formatTimestamp,
  subtractDecimalStrings,
  formatXlmDisplay,
  sanitizeChainText,
  truncateMiddle,
} from "./format";

test("sanitizeChainText replaces bidi and control characters", () => {
  expect(sanitizeChainText("pay\u202Ecod.txt")).toBe("pay\uFFFDcod.txt");
  expect(sanitizeChainText("a\u0001b\u2066c")).toBe("a\uFFFDb\uFFFDc");
});

test("sanitizeChainText keeps ordinary text, tabs, and newlines", () => {
  expect(sanitizeChainText("hello world\t1\n2")).toBe("hello world\t1\n2");
});

test("truncateMiddle keeps short values and middle-truncates long ones", () => {
  expect(truncateMiddle("abc")).toBe("abc");
  expect(
    truncateMiddle("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"),
  ).toBe("GAAZ...CWN7");
});

test("formatAmount renders stroop strings with 7 decimals", () => {
  expect(formatAmount("0")).toBe("0");
  expect(formatAmount("10000000")).toBe("1");
  expect(formatAmount("123456789")).toBe("12.3456789");
  expect(formatAmount("120000000")).toBe("12");
  expect(formatAmount("-35000000")).toBe("-3.5");
});

test("formatAmount preserves i128 precision beyond 2^53", () => {
  expect(formatAmount("92233720368547758079999999")).toBe(
    "9,223,372,036,854,775,807.9999999",
  );
});

test("formatXlmDisplay trims display precision without rounding up", () => {
  expect(formatXlmDisplay("18973")).toBe("0.00189");
  expect(formatXlmDisplay("100")).toBe("0.00001");
  expect(formatXlmDisplay("10000000")).toBe("1");
});

test("formatAmount handles zero decimals and non-integer input", () => {
  expect(formatAmount("1234", 0)).toBe("1,234");
  expect(formatAmount("abc")).toBe("abc");
});

test("decimal display groups and trims horizon amount strings", () => {
  expect(formatDecimalDisplay("12.5000000")).toBe("12.5");
  expect(formatDecimalDisplay("3750.0000000")).toBe("3,750");
  expect(formatDecimalDisplay("0.1234567")).toBe("0.12345");
  expect(formatDecimalDisplay("1000000")).toBe("1,000,000");
});

test("decimal display passes non-decimal input through unchanged", () => {
  expect(formatDecimalDisplay("12,5 lumens")).toBe("12,5 lumens");
  expect(formatDecimalDisplay("-5.0")).toBe("-5.0");
});

test("subtractDecimalStrings takes exact 7-decimal differences", () => {
  expect(subtractDecimalStrings("5126330.1050000", "5126330.1000000")).toBe(
    "0.005",
  );
  expect(subtractDecimalStrings("1000000.0000001", "999999.9999999")).toBe(
    "0.0000002",
  );
  expect(subtractDecimalStrings("5.5", "5.5")).toBe("0");
});

test("subtractDecimalStrings rejects malformed and negative results", () => {
  expect(subtractDecimalStrings("1.0", "2.0")).toBeUndefined();
  expect(subtractDecimalStrings("abc", "1.0")).toBeUndefined();
  expect(subtractDecimalStrings("1.12345678", "1.0")).toBeUndefined();
  expect(subtractDecimalStrings("", "1.0")).toBeUndefined();
});

test("formatAgo formats ages and refuses malformed timestamps", () => {
  const now = Date.parse("2026-08-24T12:00:10Z");
  expect(formatAgo("2026-08-24T12:00:06Z", now)).toBe("4s ago");
  expect(formatAgo("2026-08-24T11:58:00Z", now)).toBe("2m ago");
  expect(formatAgo("not a date", now)).toBe("-");
  expect(formatAgo("", now)).toBe("-");
});

test("amount fallthroughs sanitize hostile bytes instead of echoing them", () => {
  expect(formatAmount("\u202E9999.pay")).toBe("\uFFFD9999.pay");
  expect(formatDecimalDisplay("12,5\u202Elumens")).toBe("12,5\uFFFDlumens");
});

test("formatTimestamp renders an absolute time with its zone", () => {
  const rendered = formatTimestamp("2026-08-24T14:53:45Z");

  expect(rendered).toMatch(/Aug \d{1,2}, 2026/);
  expect(rendered).toMatch(/\d{2}:\d{2}:\d{2}/);
  expect(rendered).toMatch(/UTC|GMT/);
  expect(formatTimestamp("not a date")).toBe("-");
});
