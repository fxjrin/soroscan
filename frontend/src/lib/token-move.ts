import { formatAmount } from "@/lib/format";
import type { ScDisplay } from "@/lib/scval";
import type { TraceEvent } from "@/lib/tx-trace";

/** A balance that moved, read out of the event that moved it. */
export interface TokenMove {
  from?: string;
  to?: string;
  /** decimal string; the raw stroops never pass through a JS number */
  amount: string;
  /** the asset code, or undefined when the event did not name one */
  code?: string;
}

// the SEP-41 token interface, which every Stellar Asset Contract implements
const MOVE_EVENTS = new Set(["transfer", "mint", "burn", "clawback"]);

const AMOUNT_TYPES = new Set(["i128", "u128", "i64", "u64", "i32", "u32"]);

function addressOf(value: ScDisplay | undefined): string | undefined {
  return value?.kind === "address" ? value.address : undefined;
}

// "native", or "CODE:ISSUER" for everything else
function codeOf(value: ScDisplay | undefined): string | undefined {
  if (value?.kind !== "text") {
    return undefined;
  }
  if (value.text === "native") {
    return "XLM";
  }
  const [code] = value.text.split(":");
  return code === "" ? undefined : code;
}

/**
 * What a token event did to somebody's balance. A contract event carries the
 * amount as raw stroops among its arguments, which says little on its own;
 * this reads it as the movement it stands for, so a trace can show the money
 * where it moved rather than only where it was announced.
 *
 * Only the token interface is understood. An event of any other shape moves
 * nothing this can vouch for, and gets nothing.
 */
export function tokenMove(event: TraceEvent): TokenMove | undefined {
  const name = event.topics[0];
  if (name?.kind !== "text" || !MOVE_EVENTS.has(name.text)) {
    return undefined;
  }
  const data = event.data;
  if (data?.kind !== "text" || !AMOUNT_TYPES.has(data.type)) {
    return undefined;
  }
  const parties = event.topics.slice(1);
  // mint and clawback name one counterparty, transfer names two
  const from = name.text === "mint" ? undefined : addressOf(parties[0]);
  const to =
    name.text === "mint"
      ? addressOf(parties[0])
      : name.text === "transfer"
        ? addressOf(parties[1])
        : undefined;
  if (from === undefined && to === undefined) {
    return undefined;
  }
  return {
    from,
    to,
    amount: formatAmount(data.text),
    code: codeOf(parties[parties.length - 1]),
  };
}
