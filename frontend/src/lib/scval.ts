import { StrKey } from "@stellar/stellar-sdk/base";

/**
 * Display form of a decoded ScVal. Every number is a decimal string so
 * u64/i128/u256 chain values never touch a JS number.
 */
export type ScDisplay =
  | { kind: "text"; type: string; text: string }
  | { kind: "address"; type: "address"; address: string }
  | { kind: "vec"; type: "vec"; items: ScDisplay[] }
  | {
      kind: "map";
      type: "map";
      entries: Array<{ key: ScDisplay; value: ScDisplay }>;
    }
  | { kind: "opaque"; type: string };

const MAX_DEPTH = 8; // deeper than any real call; bounds hostile recursion
const MAX_TEXT_CHARS = 120; // display cap; the raw value stays in the XDR tab
const MAX_HEX_BYTES = 32; // full hashes render whole, blobs keep both ends

const TWO_64 = 1n << 64n;

const ERROR_TYPES = [
  "contract",
  "wasm vm",
  "context",
  "storage",
  "object",
  "crypto",
  "events",
  "budget",
  "value",
  "auth",
];

function bytesOf(base64: string): Uint8Array | undefined {
  try {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

// chain bytes are attacker-controlled, so every read is bounds-checked and
// any overrun or unknown shape aborts the whole decode
class Reader {
  private at = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  fixed(count: number): Uint8Array {
    if (this.at + count > this.bytes.length) {
      throw new RangeError("truncated scval");
    }
    const data = this.bytes.subarray(this.at, this.at + count);
    this.at += count;
    return data;
  }

  u32(): number {
    const data = this.fixed(4);
    return ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
  }

  i32(): number {
    return this.u32() | 0;
  }

  u64(): bigint {
    let value = 0n;
    for (const byte of this.fixed(8)) {
      value = (value << 8n) | BigInt(byte);
    }
    return value;
  }

  i64(): bigint {
    const value = this.u64();
    return value >= 1n << 63n ? value - TWO_64 : value;
  }

  opaque(): Uint8Array {
    const length = this.u32();
    if (length > this.remaining()) {
      throw new RangeError("truncated scval");
    }
    const data = this.fixed(length);
    this.fixed((4 - (length % 4)) % 4); // xdr pads opaques to 4 bytes
    return data;
  }

  remaining(): number {
    return this.bytes.length - this.at;
  }
}

function text(type: string, value: string): ScDisplay {
  return { kind: "text", type, text: value };
}

function hexOf(data: Uint8Array): string {
  let hex = "";
  for (const byte of data) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function formatBytes(data: Uint8Array): string {
  if (data.length <= MAX_HEX_BYTES) {
    return "0x" + hexOf(data);
  }
  const half = MAX_HEX_BYTES / 2;
  return (
    "0x" + hexOf(data.subarray(0, half)) + "..." + hexOf(data.subarray(-half))
  );
}

const utf8 = new TextDecoder(); // non-fatal: invalid bytes become U+FFFD

function formatString(data: Uint8Array): string {
  const value = utf8.decode(data);
  return value.length > MAX_TEXT_CHARS
    ? value.slice(0, MAX_TEXT_CHARS) + "..."
    : value;
}

function readSymbol(reader: Reader): string {
  const data = reader.opaque();
  const value = String.fromCharCode(...data);
  if (data.length > 32 || !/^[A-Za-z0-9_]*$/.test(value)) {
    throw new RangeError("malformed symbol");
  }
  return value;
}

function readError(reader: Reader): ScDisplay {
  const errorType = reader.u32();
  const code = reader.u32();
  if (errorType === 0) {
    return text("err", `contract error #${code}`);
  }
  return text("err", `${ERROR_TYPES[errorType] ?? "unknown"} error`);
}

function addressOf(strkey: string): ScDisplay {
  return { kind: "address", type: "address", address: strkey };
}

function readAddress(reader: Reader): ScDisplay {
  switch (reader.u32()) {
    case 0: {
      if (reader.u32() !== 0) {
        throw new RangeError("unknown public key type"); // only ed25519 exists
      }
      return addressOf(StrKey.encodeEd25519PublicKey(reader.fixed(32)));
    }
    case 1:
      return addressOf(StrKey.encodeContract(reader.fixed(32)));
    case 2: {
      const id = reader.fixed(8);
      const ed25519 = reader.fixed(32);
      const payload = new Uint8Array(40);
      payload.set(ed25519, 0);
      payload.set(id, 32); // the M strkey wants the mux id after the key
      return addressOf(StrKey.encodeMed25519PublicKey(payload));
    }
    case 3: {
      if (reader.u32() !== 0) {
        throw new RangeError("unknown claimable balance id type");
      }
      const payload = new Uint8Array(33);
      payload.set(reader.fixed(32), 1); // leading v0 type byte stays zero
      return addressOf(StrKey.encodeClaimableBalance(payload));
    }
    case 4:
      return addressOf(StrKey.encodeLiquidityPool(reader.fixed(32)));
    default:
      throw new RangeError("unknown address kind");
  }
}

function readCount(reader: Reader): number {
  const count = reader.u32();
  if (count > reader.remaining() / 4) {
    throw new RangeError("scval count exceeds payload");
  }
  return count;
}

function readVecItems(reader: Reader, depth: number): ScDisplay[] {
  const count = readCount(reader);
  const items: ScDisplay[] = [];
  for (let index = 0; index < count; index++) {
    items.push(readScVal(reader, depth));
  }
  return items;
}

function readMapEntries(
  reader: Reader,
  depth: number,
): Array<{ key: ScDisplay; value: ScDisplay }> {
  const count = readCount(reader);
  const entries: Array<{ key: ScDisplay; value: ScDisplay }> = [];
  for (let index = 0; index < count; index++) {
    const key = readScVal(reader, depth);
    const value = readScVal(reader, depth);
    entries.push({ key, value });
  }
  return entries;
}

function readPresence(reader: Reader): boolean {
  const flag = reader.u32();
  if (flag > 1) {
    throw new RangeError("malformed optional flag");
  }
  return flag === 1;
}

function readScVal(reader: Reader, depth: number): ScDisplay {
  if (depth > MAX_DEPTH) {
    throw new RangeError("scval too deep");
  }
  switch (reader.u32()) {
    case 0:
      return text("bool", reader.u32() === 0 ? "false" : "true");
    case 1:
      return text("void", "void");
    case 2:
      return readError(reader);
    case 3:
      return text("u32", String(reader.u32()));
    case 4:
      return text("i32", String(reader.i32()));
    case 5:
      return text("u64", reader.u64().toString());
    case 6:
      return text("i64", reader.i64().toString());
    case 7:
      return text("time", reader.u64().toString());
    case 8:
      return text("dur", reader.u64().toString());
    case 9: {
      const hi = reader.u64();
      const lo = reader.u64();
      return text("u128", (hi * TWO_64 + lo).toString());
    }
    case 10: {
      const hi = reader.i64();
      const lo = reader.u64();
      return text("i128", (hi * TWO_64 + lo).toString());
    }
    case 11: {
      const hiHi = reader.u64();
      const hiLo = reader.u64();
      const loHi = reader.u64();
      const loLo = reader.u64();
      const value = ((hiHi * TWO_64 + hiLo) * TWO_64 + loHi) * TWO_64 + loLo;
      return text("u256", value.toString());
    }
    case 12: {
      const hiHi = reader.i64();
      const hiLo = reader.u64();
      const loHi = reader.u64();
      const loLo = reader.u64();
      const value = ((hiHi * TWO_64 + hiLo) * TWO_64 + loHi) * TWO_64 + loLo;
      return text("i256", value.toString());
    }
    case 13:
      return text("bytes", formatBytes(reader.opaque()));
    case 14:
      return text("str", formatString(reader.opaque()));
    case 15:
      return text("sym", readSymbol(reader));
    case 16: {
      const items = readPresence(reader) ? readVecItems(reader, depth + 1) : [];
      return { kind: "vec", type: "vec", items };
    }
    case 17: {
      const entries = readPresence(reader)
        ? readMapEntries(reader, depth + 1)
        : [];
      return { kind: "map", type: "map", entries };
    }
    case 18:
      return readAddress(reader);
    case 19: {
      if (reader.u32() === 0) {
        reader.fixed(32); // wasm executable hash
      }
      if (readPresence(reader)) {
        readMapEntries(reader, depth + 1); // instance storage, not shown
      }
      return { kind: "opaque", type: "contract instance" };
    }
    case 20:
      return { kind: "opaque", type: "ledger key" };
    case 21:
      return text("nonce", reader.i64().toString());
    default:
      throw new RangeError("unknown scval type");
  }
}

/**
 * Decodes a base64 ScVal into its display form. Malformed, truncated, or
 * unknown-typed input returns undefined rather than a partial value.
 */
export function decodeScVal(base64: string): ScDisplay | undefined {
  const bytes = bytesOf(base64);
  if (bytes === undefined) {
    return undefined;
  }
  try {
    return readScVal(new Reader(bytes), 0);
  } catch {
    return undefined;
  }
}

/**
 * Decodes a base64 SCV_ADDRESS ScVal to its strkey, covering all five
 * CAP-67 address kinds (G, C, M, B, L). Anything else returns undefined.
 */
export function decodeScAddress(base64: string): string | undefined {
  const value = decodeScVal(base64);
  return value?.kind === "address" ? value.address : undefined;
}

/**
 * Decodes a base64 SCV_SYMBOL ScVal. Symbols are limited to 32 chars of
 * [a-zA-Z0-9_] on chain; anything outside that is rejected as malformed.
 */
export function decodeScSymbol(base64: string): string | undefined {
  const value = decodeScVal(base64);
  return value?.kind === "text" && value.type === "sym" && value.text !== ""
    ? value.text
    : undefined;
}
