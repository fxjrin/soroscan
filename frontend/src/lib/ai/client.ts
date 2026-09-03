import type { NetworkId } from "@/lib/network";

export type AiEntityKind = "tx" | "account" | "contract" | "ledger" | "asset";

export interface AiRef {
  kind: AiEntityKind;
  id: string;
}

export interface AiAsset {
  code: string;
  issuer?: string;
}

export interface AiView {
  kind: string;
  id: string;
  tab: string;
}

export interface AiAnalysis {
  summary: string;
  highlights: string[];
  caveats: string[];
  assets: AiAsset[];
  view?: AiView;
  cached: boolean;
}

function parseView(v: unknown): AiView | undefined {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (
      typeof o.kind === "string" &&
      typeof o.id === "string" &&
      typeof o.tab === "string"
    ) {
      return { kind: o.kind, id: o.id, tab: o.tab };
    }
  }
  return undefined;
}

export interface AiHistoryTurn {
  question: string;
  answer: string;
}

// Dev routes through the Vite proxy (see vite.config.ts) so the browser stays
// same-origin; production calls the cross-origin api host, which allow-lists
// the soroscan domains.
const AI_BASE = import.meta.env.DEV ? "/ai" : "https://api.soroscan.io/ai";

export class AiError extends Error {}

/**
 * Sends a free-form question to the analysis backend. `context` is the entity
 * the user is currently viewing, an optional hint the backend adds to whatever
 * ids it finds in the question itself.
 */
export async function askAi(
  question: string,
  network: NetworkId,
  context: AiRef | null,
  history: AiHistoryTurn[],
  signal?: AbortSignal,
): Promise<AiAnalysis> {
  let response: Response;
  try {
    response = await fetch(`${AI_BASE}/v1/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        network,
        question,
        context: context ?? undefined,
        history: history.length ? history : undefined,
      }),
      signal,
    });
  } catch {
    throw new AiError("Could not reach the analysis service.");
  }
  if (!response.ok) {
    throw new AiError(
      response.status === 429
        ? "The analysis service is busy right now. Try again in a moment."
        : "The analysis service could not answer that.",
    );
  }
  const body = (await response.json()) as Partial<AiAnalysis>;
  if (typeof body.summary !== "string") {
    throw new AiError("The analysis service returned an unexpected response.");
  }
  return {
    summary: body.summary,
    highlights: Array.isArray(body.highlights) ? body.highlights : [],
    caveats: Array.isArray(body.caveats) ? body.caveats : [],
    assets: Array.isArray(body.assets)
      ? body.assets.filter(
          (asset): asset is AiAsset =>
            typeof asset?.code === "string" && asset.code !== "",
        )
      : [],
    view: parseView(body.view),
    cached: body.cached === true,
  };
}
