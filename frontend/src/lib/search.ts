import { StrKey } from "@stellar/stellar-sdk/base";

export type SearchTarget =
  | { type: "account"; value: string }
  | { type: "contract"; value: string }
  | { type: "tx"; value: string }
  | { type: "ledger"; value: string }
  | { type: "unknown"; value: string };

export function classifySearch(raw: string): SearchTarget {
  const value = raw.trim();
  if (
    StrKey.isValidEd25519PublicKey(value) ||
    StrKey.isValidMed25519PublicKey(value)
  ) {
    return { type: "account", value };
  }
  if (StrKey.isValidContract(value)) {
    return { type: "contract", value };
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return { type: "tx", value: value.toLowerCase() };
  }
  if (/^\d+$/.test(value)) {
    return { type: "ledger", value };
  }
  return { type: "unknown", value };
}

export function searchTargetPath(target: SearchTarget): string | null {
  switch (target.type) {
    case "account":
      return `/account/${target.value}`;
    case "contract":
      return `/contract/${target.value}`;
    case "tx":
      return `/tx/${target.value}`;
    case "ledger":
      return `/ledger/${target.value}`;
    case "unknown":
      return null;
  }
}
