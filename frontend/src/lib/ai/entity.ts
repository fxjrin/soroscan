import type { AiEntityKind, AiRef } from "@/lib/ai/client";
import { classifySearch } from "@/lib/search";

const KIND_BY_SEGMENT: Record<string, AiEntityKind> = {
  tx: "tx",
  account: "account",
  contract: "contract",
  ledger: "ledger",
  asset: "asset",
};

const KIND_LABELS: Record<AiEntityKind, string> = {
  tx: "Transaction",
  account: "Account",
  contract: "Contract",
  ledger: "Ledger",
  asset: "Asset",
};

// an asset page is addressed as "CODE-ISSUER" (or "XLM" for the native asset),
// which is not a single strkey, so it bypasses the classifier
const ASSET_ID = /^([A-Za-z0-9]{1,12}-G[A-Z2-7]{55}|XLM)$/;

export function kindLabel(kind: AiEntityKind): string {
  return KIND_LABELS[kind];
}

/**
 * Reads the entity the visitor is currently looking at from the route path, to
 * pass as an optional context hint. The classified id wins over the url
 * segment, so a malformed path yields no hint rather than a bad reference.
 */
export function routeEntityFromPath(pathname: string): AiRef | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const kind = KIND_BY_SEGMENT[parts[0]];
  if (!kind) {
    return null;
  }
  const raw = decodeURIComponent(parts[1]);
  if (kind === "asset") {
    return ASSET_ID.test(raw) ? { kind, id: raw } : null;
  }
  const target = classifySearch(raw);
  if (target.type !== kind) {
    return null;
  }
  return { kind, id: target.value };
}

export function suggestionsFor(kind: AiEntityKind): string[] {
  switch (kind) {
    case "tx":
      return [
        "What happened in this transaction?",
        "Were any contracts called?",
      ];
    case "contract":
      return ["What does this contract do?", "Which functions are used most?"];
    case "account":
      return ["What has this account been doing?", "What does it hold?"];
    case "ledger":
      return ["What is notable in this ledger?", "How busy was this ledger?"];
    case "asset":
      return ["What is this token?", "How many holders does it have?"];
  }
}

export const GENERAL_SUGGESTIONS = [
  "What is Soroban?",
  "How do trustlines work on Stellar?",
];

const ID_IN_TEXT = /[GC][A-Z2-7]{55}|[0-9a-fA-F]{64}/g;
const LEDGER_CUE = /\bledger\s+#?(\d{1,12})\b/i;

/**
 * Finds the first entity a snippet of free text refers to, used to carry the
 * conversation subject forward. A bare number is only read as a ledger when the
 * word "ledger" precedes it, matching the backend's own extraction.
 */
export function firstRefIn(text: string): AiRef | null {
  for (const match of text.matchAll(ID_IN_TEXT)) {
    const target = classifySearch(match[0]);
    if (
      target.type === "account" ||
      target.type === "contract" ||
      target.type === "tx"
    ) {
      return { kind: target.type, id: target.value };
    }
  }
  const ledger = text.match(LEDGER_CUE);
  if (ledger) {
    return { kind: "ledger", id: ledger[1] };
  }
  return null;
}
