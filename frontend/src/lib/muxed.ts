import { StrKey } from "@stellar/stellar-sdk/base";

/** A muxed address is one real account plus a number the sender chose. */
export interface MuxedAddress {
  /** the account that actually exists on the ledger */
  base: string;
  /** the subaccount id, a u64 kept as a string so it never rounds */
  id: string;
}

// 32 bytes of ed25519 key, then the id as a big-endian u64
const KEY_BYTES = 32;

/**
 * Splits an M address into the account the ledger knows and the id riding
 * along with it. Everything on chain, balances and history alike, belongs to
 * the base account: the id only tells the receiver which of their customers
 * a payment was for, so an explorer has to look the base account up and say
 * where the id went.
 *
 * Anything that is not a muxed address resolves to nothing.
 */
export function resolveMuxed(address: string): MuxedAddress | undefined {
  if (!StrKey.isValidMed25519PublicKey(address)) {
    return undefined;
  }
  try {
    const raw = StrKey.decodeMed25519PublicKey(address);
    const view = new DataView(
      raw.buffer,
      raw.byteOffset + KEY_BYTES,
      raw.byteLength - KEY_BYTES,
    );
    return {
      base: StrKey.encodeEd25519PublicKey(raw.subarray(0, KEY_BYTES)),
      id: view.getBigUint64(0).toString(),
    };
  } catch {
    return undefined; // a checksum that passed but bytes that did not
  }
}
