/** The blob shapes a transaction detail page carries. */
export type XdrKind =
  "TransactionEnvelope" | "TransactionResult" | "LedgerEntryChanges";

/**
 * Decodes a base64 XDR blob into the plain object the SDK's own JSON
 * walker produces. That walker renders int64 and uint64 as strings, so
 * no chain value passes through a JS number on the way to the screen.
 * The generated XDR classes load as their own chunk, the same one the
 * call trace already uses. Malformed input decodes to undefined.
 */
export async function decodeXdrJson(
  value: string,
  kind: XdrKind,
): Promise<unknown | undefined> {
  const xdr = await import("@stellar/stellar-sdk/xdr");
  try {
    if (kind === "LedgerEntryChanges") {
      return xdr
        .decodeArray(xdr.LedgerEntryChange, value, "base64")
        .map((change) => change.toJson());
    }
    if (kind === "TransactionResult") {
      return xdr.TransactionResult.fromXdr(value, "base64").toJson();
    }
    return xdr.TransactionEnvelope.fromXdr(value, "base64").toJson();
  } catch {
    return undefined;
  }
}
