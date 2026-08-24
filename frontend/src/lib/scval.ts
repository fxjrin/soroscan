import { StrKey } from "@stellar/stellar-sdk/base";

const SCV_SYMBOL = 15;
const SCV_ADDRESS = 18;
const SC_ADDRESS_TYPE_ACCOUNT = 0;
const SC_ADDRESS_TYPE_CONTRACT = 1;
const KEY_TYPE_ED25519 = 0;

function bytesOf(base64: string): Uint8Array | undefined {
  try {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function u32At(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] << 24) |
      (bytes[at + 1] << 16) |
      (bytes[at + 2] << 8) |
      bytes[at + 3]) >>>
    0
  );
}

/**
 * Decodes a base64 SCV_ADDRESS ScVal to its strkey (C... or G...) without
 * pulling the full XDR machinery into the bundle. Anything that is not a
 * plain contract or ed25519 account address returns undefined.
 */
export function decodeScAddress(base64: string): string | undefined {
  const bytes = bytesOf(base64);
  if (
    bytes === undefined ||
    bytes.length < 8 ||
    u32At(bytes, 0) !== SCV_ADDRESS
  ) {
    return undefined;
  }
  const kind = u32At(bytes, 4);
  if (kind === SC_ADDRESS_TYPE_CONTRACT && bytes.length >= 40) {
    return StrKey.encodeContract(bytes.slice(8, 40));
  }
  if (
    kind === SC_ADDRESS_TYPE_ACCOUNT &&
    bytes.length >= 44 &&
    u32At(bytes, 8) === KEY_TYPE_ED25519
  ) {
    return StrKey.encodeEd25519PublicKey(bytes.slice(12, 44));
  }
  return undefined;
}

/**
 * Decodes a base64 SCV_SYMBOL ScVal. Symbols are limited to 32 chars of
 * [a-zA-Z0-9_] on chain; anything outside that is rejected as malformed.
 */
export function decodeScSymbol(base64: string): string | undefined {
  const bytes = bytesOf(base64);
  if (
    bytes === undefined ||
    bytes.length < 8 ||
    u32At(bytes, 0) !== SCV_SYMBOL
  ) {
    return undefined;
  }
  const length = u32At(bytes, 4);
  if (length < 1 || length > 32 || bytes.length < 8 + length) {
    return undefined;
  }
  const text = String.fromCharCode(...bytes.slice(8, 8 + length));
  return /^[A-Za-z0-9_]+$/.test(text) ? text : undefined;
}
