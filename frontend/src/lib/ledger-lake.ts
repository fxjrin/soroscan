import type { NetworkId } from "@/lib/network";

// the public archive of Stellar ledger metadata, served by the AWS Open
// Data program. Unlike RPC it keeps the whole history, and unlike Horizon
// its meta carries the diagnostic events a call tree is built from
const LAKE_BASE =
  "https://aws-public-blockchain.s3.amazonaws.com/v1.1/stellar/ledgers/pubnet";

// SEP-54 layout, as the pubnet lake is written: one ledger per file, in
// partitions of 64000
const LEDGERS_PER_PARTITION = 64000;

const MAX_UINT32 = 0xffffffff;

// the archive names files by the complement of the sequence, so a plain
// lexicographic listing walks backwards in time
function complement(sequence: number): string {
  return (MAX_UINT32 - sequence).toString(16).toUpperCase().padStart(8, "0");
}

/** Where one ledger sits in the archive, relative to the pubnet root. */
export function lakeObjectKey(sequence: number): string {
  const start =
    Math.floor(sequence / LEDGERS_PER_PARTITION) * LEDGERS_PER_PARTITION;
  const end = start + LEDGERS_PER_PARTITION - 1;
  return (
    `${complement(start)}--${start}-${end}/` +
    `${complement(sequence)}--${sequence}.xdr.zst`
  );
}

function toHex(bytes: ArrayBufferView): string {
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * The execution meta of one transaction, read from the public ledger
 * archive. This is the only source that still has diagnostic events for a
 * transaction older than RPC retention, and those events are what a nested
 * call tree is built from.
 *
 * A ledger is one compressed file of a few hundred KB, so this is worth
 * doing when a reader opens an old transaction and not before.
 */
export async function fetchArchivedMeta(
  network: NetworkId,
  sequence: number,
  hash: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  // only the public network is published under this program
  if (network !== "mainnet" || !Number.isSafeInteger(sequence)) {
    return undefined;
  }
  try {
    const response = await fetch(`${LAKE_BASE}/${lakeObjectKey(sequence)}`, {
      signal,
    });
    if (!response.ok) {
      return undefined;
    }
    // the decompressor and the generated XDR classes are both dead weight
    // for a reader who never opens a transaction this old, so neither is in
    // the bundle the page starts with
    const [{ decompress }, xdr] = await Promise.all([
      import("fzstd"),
      import("@stellar/stellar-sdk/xdr"),
    ]);
    const raw = decompress(new Uint8Array(await response.arrayBuffer()));
    const batch = xdr.LedgerCloseMetaBatch.fromXdr(raw);
    for (const close of batch.ledgerCloseMetas) {
      const arm =
        close.type === "v0"
          ? close.v0
          : close.type === "v1"
            ? close.v1
            : close.v2;
      for (const applied of arm.txProcessing) {
        if (toHex(applied.result.transactionHash.toXdr()) === hash) {
          return applied.txApplyProcessing.toXdr("base64");
        }
      }
    }
    return undefined;
  } catch {
    // the archive is a third party. Unreachable, or serving something this
    // cannot read, it costs the trace nothing that was not already missing
    return undefined;
  }
}
