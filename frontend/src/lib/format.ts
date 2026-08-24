// Bidi controls (U+202A-202E, U+2066-2069), LRM/RLM (U+200E-200F), and
// C0/C1 controls minus tab/newline: all of these can reorder or hide
// neighboring text in an attacker-chosen way
const HOSTILE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

const REPLACEMENT_CHAR = "\uFFFD";

export function sanitizeChainText(value: string): string {
  return value.replace(HOSTILE_CHARS, REPLACEMENT_CHAR);
}

export function truncateMiddle(value: string, visible = 4): string {
  if (value.length <= visible * 2 + 3) {
    return value;
  }
  return `${value.slice(0, visible)}...${value.slice(-visible)}`;
}

/** Display-only trim to 5 fraction digits; full precision stays on detail pages. */
export function formatXlmDisplay(stroops: string): string {
  const full = formatAmount(stroops);
  const dot = full.indexOf(".");
  if (dot === -1 || full.length - dot - 1 <= 5) {
    return full;
  }
  return full
    .slice(0, dot + 6)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

export function formatAgo(iso: string, nowMs: number): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return "-";
  }
  const seconds = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Display-only formatting for Horizon decimal amount strings ("12.5000000"):
 * grouped integer part, fraction trimmed to 5 digits. Never touches a JS
 * number; non-decimal input is returned unchanged.
 */
export function formatDecimalDisplay(value: string, maxFraction = 5): string {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    return sanitizeChainText(value);
  }
  const [intPart, fraction = ""] = value.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = fraction.slice(0, maxFraction).replace(/0+$/, "");
  return trimmed === "" ? grouped : grouped + "." + trimmed;
}

/**
 * Difference of two 7-decimal amount strings (fee pools, balances) as a
 * decimal string, exact via BigInt. Malformed input or a negative result
 * (a provider glitch, never a real chain state) returns undefined.
 */
export function subtractDecimalStrings(
  minuend: string,
  subtrahend: string,
): string | undefined {
  const shape = /^\d+(\.\d{1,7})?$/;
  if (!shape.test(minuend) || !shape.test(subtrahend)) {
    return undefined;
  }
  const toStroops = (value: string) => {
    const [intPart, fraction = ""] = value.split(".");
    return BigInt(intPart + fraction.padEnd(7, "0"));
  };
  const delta = toStroops(minuend) - toStroops(subtrahend);
  if (delta < 0n) {
    return undefined;
  }
  const digits = delta.toString().padStart(8, "0");
  const intPart = digits.slice(0, -7);
  const fraction = digits.slice(-7).replace(/0+$/, "");
  return fraction === "" ? intPart : intPart + "." + fraction;
}

/**
 * Formats an integer amount string (stroops or token base units) without
 * ever passing it through a JS number, so i64/i128 precision is preserved.
 * Returns the input unchanged when it is not a plain integer string.
 */
export function formatAmount(raw: string, decimals = 7): string {
  if (!/^-?\d+$/.test(raw)) {
    return sanitizeChainText(raw); // the fallthrough must never carry hostile bytes
  }
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, "0");
  const intPart = digits.slice(0, digits.length - decimals);
  const fraction =
    decimals > 0 ? digits.slice(-decimals).replace(/0+$/, "") : "";
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (negative ? "-" : "") + grouped + (fraction ? "." + fraction : "");
}
