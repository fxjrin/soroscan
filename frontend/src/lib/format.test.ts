import { expect, test } from "vitest";
import { formatAmount, sanitizeChainText, truncateMiddle } from "./format";

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

test("formatAmount handles zero decimals and non-integer input", () => {
  expect(formatAmount("1234", 0)).toBe("1,234");
  expect(formatAmount("abc")).toBe("abc");
});
