import { decimalToStroops, formatAmount } from "@/lib/format";
import type { AccountRecord, BalanceRecord } from "@/lib/horizon/client";

// the network's base reserve, unchanged since launch and movable only by a
// validator vote on a protocol upgrade. Reading it per account would cost a
// request on every page for a number that is the same on all of them
const BASE_RESERVE_STROOPS = 5_000_000n;

// every account pays for its own entry plus one more, before any subentry
const BASE_ENTRIES = 2n;

/** How an account's XLM splits between what it must keep and what it can move. */
export interface XlmBreakdown {
  /** decimal strings, so no balance passes through a JS number */
  total: string;
  reserved: string;
  liabilities: string;
  spendable: string;
}

function stroopsOf(value: string | undefined): bigint {
  return value === undefined ? 0n : (decimalToStroops(value) ?? 0n);
}

export function nativeBalance(
  account: AccountRecord,
): BalanceRecord | undefined {
  return account.balances.find((balance) => balance.asset_type === "native");
}

/**
 * Splits the XLM balance into the part the ledger locks and the part the
 * account can actually spend. An account pays a reserve for itself and for
 * every subentry it owns: trustlines, offers, signers, and data entries.
 * Sponsored entries are paid for by someone else, and entries this account
 * sponsors for others are paid for here.
 */
export function xlmBreakdown(account: AccountRecord): XlmBreakdown | undefined {
  const native = nativeBalance(account);
  if (native === undefined) {
    return undefined;
  }
  const total = stroopsOf(native.balance);
  const sponsoring = BigInt(account.num_sponsoring ?? 0);
  const sponsored = BigInt(account.num_sponsored ?? 0);
  const entries =
    BASE_ENTRIES + BigInt(account.subentry_count) + sponsoring - sponsored;
  // a heavily sponsored account can owe fewer entries than the base two,
  // and the ledger never asks for a negative reserve
  const reserved = entries > 0n ? entries * BASE_RESERVE_STROOPS : 0n;
  const liabilities = stroopsOf(native.selling_liabilities);
  const spendable = total - reserved - liabilities;
  return {
    total: formatAmount(total.toString()),
    reserved: formatAmount(reserved.toString()),
    liabilities: formatAmount(liabilities.toString()),
    spendable: formatAmount((spendable > 0n ? spendable : 0n).toString()),
  };
}

/**
 * Balances in reading order: XLM first because it is the one every account
 * has, then the rest by asset code so the list is stable between refreshes.
 * Liquidity pool shares sort last; they have no code of their own.
 */
export function sortedBalances(account: AccountRecord): BalanceRecord[] {
  return [...account.balances].sort((left, right) => {
    if (left.asset_type !== right.asset_type) {
      if (left.asset_type === "native") return -1;
      if (right.asset_type === "native") return 1;
      if (left.asset_type === "liquidity_pool_shares") return 1;
      if (right.asset_type === "liquidity_pool_shares") return -1;
    }
    return (left.asset_code ?? "").localeCompare(right.asset_code ?? "");
  });
}

/** The flags an account has turned on, in the order the protocol lists them. */
export function enabledFlags(account: AccountRecord): string[] {
  const flags = account.flags;
  const enabled: string[] = [];
  if (flags?.auth_required) enabled.push("auth required");
  if (flags?.auth_revocable) enabled.push("auth revocable");
  if (flags?.auth_immutable) enabled.push("auth immutable");
  if (flags?.auth_clawback_enabled) enabled.push("clawback enabled");
  return enabled;
}
