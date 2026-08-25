import { StrKey } from "@stellar/stellar-sdk/base";

export interface DecoratedSignature {
  hint: string; // hex of the last 4 bytes of the signer's public key
  signature: string; // base64, exactly as Horizon reports it
}

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

function hexOf(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function padded(length: number): number {
  return length + ((4 - (length % 4)) % 4);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Recovers the signer hints for a transaction's signatures. The
 * decorated signature vector is the last field of every envelope shape,
 * and its exact size follows from the signature lengths Horizon
 * reports, so the tail parses without decoding the transaction itself.
 * Every parsed signature must byte-match Horizon's copy; any mismatch
 * discards the whole parse instead of risking a wrong attribution.
 */
export function extractSignatureHints(
  envelopeXdr: string,
  signatures: string[],
): DecoratedSignature[] | undefined {
  const envelope = bytesOf(envelopeXdr);
  if (envelope === undefined || signatures.length === 0) {
    return undefined;
  }
  const expected: Uint8Array[] = [];
  for (const signature of signatures) {
    const bytes = bytesOf(signature);
    if (bytes === undefined) {
      return undefined;
    }
    expected.push(bytes);
  }
  const tailLength =
    4 + expected.reduce((sum, bytes) => sum + 8 + padded(bytes.length), 0);
  if (envelope.length < tailLength) {
    return undefined;
  }
  let at = envelope.length - tailLength;
  if (u32At(envelope, at) !== signatures.length) {
    return undefined;
  }
  at += 4;
  const out: DecoratedSignature[] = [];
  for (let index = 0; index < expected.length; index++) {
    const hint = envelope.subarray(at, at + 4);
    at += 4;
    if (u32At(envelope, at) !== expected[index].length) {
      return undefined;
    }
    at += 4;
    const body = envelope.subarray(at, at + expected[index].length);
    at += padded(expected[index].length);
    if (!sameBytes(body, expected[index])) {
      return undefined;
    }
    out.push({ hint: hexOf(hint), signature: signatures[index] });
  }
  return out;
}

/** The 4-byte hint (hex) of a G address, for matching signatures to signers. */
export function addressHint(address: string): string | undefined {
  try {
    return hexOf(StrKey.decodeEd25519PublicKey(address).subarray(28));
  } catch {
    return undefined;
  }
}
