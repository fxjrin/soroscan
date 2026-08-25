import { decodeScVal, type ScDisplay } from "@/lib/scval";

/**
 * Decodes the soroban return value out of a base64 TransactionMeta,
 * tolerating both the V3 and V4 meta shapes. The generated XDR classes
 * would triple the core bundle, so they load as their own chunk the
 * first time a contract call is inspected.
 */
export async function decodeReturnValue(
  resultMetaXdr: string,
): Promise<ScDisplay | undefined> {
  const xdr = await import("@stellar/stellar-sdk/xdr");
  try {
    const meta = xdr.TransactionMeta.fromXdr(resultMetaXdr, "base64");
    if (!xdr.TransactionMeta.is(meta)) {
      return undefined;
    }
    const value =
      meta.type === "v3"
        ? meta.v3.sorobanMeta?.returnValue
        : meta.type === "v4"
          ? meta.v4.sorobanMeta?.returnValue
          : undefined;
    if (value === undefined || value === null) {
      return undefined;
    }
    return decodeScVal(value.toXdr("base64"));
  } catch {
    return undefined; // classic or malformed meta simply has no return value
  }
}
