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

/**
 * Formats an integer amount string (stroops or token base units) without
 * ever passing it through a JS number, so i64/i128 precision is preserved.
 * Returns the input unchanged when it is not a plain integer string.
 */
export function formatAmount(raw: string, decimals = 7): string {
  if (!/^-?\d+$/.test(raw)) {
    return raw;
  }
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, "0");
  const intPart = digits.slice(0, digits.length - decimals);
  const fraction =
    decimals > 0 ? digits.slice(-decimals).replace(/0+$/, "") : "";
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (negative ? "-" : "") + grouped + (fraction ? "." + fraction : "");
}
