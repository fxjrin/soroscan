import type { OperationRecord, TxRecord } from "@/lib/horizon/client";
import { sanitizeChainText } from "@/lib/format";
import { decodeScAddress, decodeScSymbol } from "@/lib/scval";

export type OpFamily = "transfer" | "contract" | "dex" | "config" | "other";

export interface PrimaryOp {
  type: string;
  label: string;
  family: OpFamily;
  detail?: string;
  toHint?: string;
  from?: string;
  to?: string;
  amount?: string;
  assetCode?: string;
  /** what went in, when an operation trades one asset for another */
  sourceAmount?: string;
  sourceAssetCode?: string;
  /** what an offer asks for, and at what rate */
  buyingAssetCode?: string;
  price?: string;
  /** the ceiling a trustline sets; "0" retires the line */
  limit?: string;
  /** how many hops a path payment took, when it took more than none */
  hops?: number;
}

export interface ActivityRow {
  tx: TxRecord;
  op?: PrimaryOp;
}

const OP_PRESENTATIONS: Record<string, { label: string; family: OpFamily }> = {
  payment: { label: "Payment", family: "transfer" },
  path_payment_strict_send: { label: "Path payment", family: "transfer" },
  path_payment_strict_receive: { label: "Path payment", family: "transfer" },
  create_account: { label: "Create account", family: "transfer" },
  account_merge: { label: "Account merge", family: "transfer" },
  create_claimable_balance: { label: "Claimable balance", family: "transfer" },
  claim_claimable_balance: { label: "Claim balance", family: "transfer" },
  clawback: { label: "Clawback", family: "transfer" },
  clawback_claimable_balance: { label: "Clawback", family: "transfer" },
  invoke_host_function: { label: "Contract call", family: "contract" },
  extend_footprint_ttl: { label: "Extend TTL", family: "contract" },
  restore_footprint: { label: "Restore data", family: "contract" },
  manage_sell_offer: { label: "DEX offer", family: "dex" },
  manage_buy_offer: { label: "DEX offer", family: "dex" },
  create_passive_sell_offer: { label: "DEX offer", family: "dex" },
  liquidity_pool_deposit: { label: "LP deposit", family: "dex" },
  liquidity_pool_withdraw: { label: "LP withdraw", family: "dex" },
  change_trust: { label: "Trustline", family: "config" },
  set_trust_line_flags: { label: "Trustline flags", family: "config" },
  allow_trust: { label: "Trustline flags", family: "config" },
  set_options: { label: "Set options", family: "config" },
  manage_data: { label: "Manage data", family: "config" },
  bump_sequence: { label: "Bump sequence", family: "config" },
  begin_sponsoring_future_reserves: { label: "Sponsorship", family: "config" },
  end_sponsoring_future_reserves: { label: "Sponsorship", family: "config" },
  revoke_sponsorship: { label: "Sponsorship", family: "config" },
  inflation: { label: "Inflation", family: "config" },
};

function amountOf(value: string | undefined): string | undefined {
  return value !== undefined && /^\d+(\.\d+)?$/.test(value) ? value : undefined;
}

export function assetCodeOf(
  assetType: string | undefined,
  assetCode: string | undefined,
): string | undefined {
  if (assetType === "native") {
    return "XLM";
  }
  const code = sanitizeChainText(assetCode ?? "");
  return code === "" || code.length > 12 ? undefined : code; // protocol caps codes at 12
}

const INVOKE_CONTRACT_FN = "HostFunctionTypeHostFunctionTypeInvokeContract";

/** True when the operation calls a contract function (not wasm upload or deploy). */
export function isContractInvocation(op: OperationRecord): boolean {
  return (
    op.type === "invoke_host_function" && op.function === INVOKE_CONTRACT_FN
  );
}

// horizon's own address field is empty in practice, so the invoked
// contract and function come from the first two invocation parameters
function presentInvoke(op: OperationRecord, base: PrimaryOp): PrimaryOp {
  const invoke = op.function === INVOKE_CONTRACT_FN;
  const target = invoke
    ? decodeScAddress(op.parameters?.[0]?.value ?? "")
    : undefined;
  const detail = invoke
    ? decodeScSymbol(op.parameters?.[1]?.value ?? "")
    : undefined;
  const moved = op.asset_balance_changes?.find(
    (change) => change.type === "transfer" || change.type === "mint",
  );
  const to = (op.address || undefined) ?? target;
  return {
    ...base,
    detail,
    from: op.source_account,
    to,
    toHint: to === undefined ? "contract" : undefined,
    amount: amountOf(moved?.amount),
    assetCode: moved
      ? assetCodeOf(moved.asset_type, moved.asset_code)
      : undefined,
  };
}

// claimable balance asset field is "native" or "CODE:ISSUER"
function claimableCodeOf(asset: string | undefined): string | undefined {
  if (asset === undefined) {
    return undefined;
  }
  if (asset === "native") {
    return "XLM";
  }
  const code = sanitizeChainText(asset.split(":")[0] ?? "");
  return code === "" || code.length > 12 ? undefined : code;
}

export function presentOperation(op: OperationRecord): PrimaryOp {
  const preset = OP_PRESENTATIONS[op.type];
  const base = {
    type: op.type,
    label: preset?.label ?? sanitizeChainText(op.type).replace(/_/g, " "),
    family: preset?.family ?? ("other" as OpFamily),
  };
  switch (op.type) {
    case "payment":
      return {
        ...base,
        from: op.from,
        to: op.to,
        amount: amountOf(op.amount),
        assetCode: assetCodeOf(op.asset_type, op.asset_code),
      };
    // a path payment is a swap when it lands back on the sender, and a
    // payment in one asset paid for with another when it does not
    case "path_payment_strict_send":
    case "path_payment_strict_receive": {
      const assetCode = assetCodeOf(op.asset_type, op.asset_code);
      const sourceAssetCode = assetCodeOf(
        op.source_asset_type,
        op.source_asset_code,
      );
      // one asset in and another out is a swap; the same asset on both
      // sides is a payment that merely took a route
      const swapped =
        assetCode !== undefined &&
        sourceAssetCode !== undefined &&
        assetCode !== sourceAssetCode;
      return {
        ...base,
        label: swapped ? "Swap" : base.label,
        from: op.from,
        to: op.to,
        amount: amountOf(op.amount),
        assetCode,
        sourceAmount: amountOf(op.source_amount),
        sourceAssetCode,
        hops: op.path?.length,
      };
    }
    case "create_account":
      return {
        ...base,
        from: op.funder,
        to: op.account,
        amount: amountOf(op.starting_balance),
        assetCode: "XLM",
      };
    case "account_merge":
      return { ...base, from: op.account ?? op.source_account, to: op.into };
    case "invoke_host_function":
      return presentInvoke(op, base);
    case "manage_sell_offer":
    case "create_passive_sell_offer":
      return {
        ...base,
        from: op.source_account,
        toHint: "order book",
        amount: amountOf(op.amount),
        assetCode: assetCodeOf(op.selling_asset_type, op.selling_asset_code),
        buyingAssetCode: assetCodeOf(
          op.buying_asset_type,
          op.buying_asset_code,
        ),
        price: amountOf(op.price),
      };
    case "manage_buy_offer":
      return {
        ...base,
        from: op.source_account,
        toHint: "order book",
        amount: amountOf(op.amount),
        assetCode: assetCodeOf(op.buying_asset_type, op.buying_asset_code),
        buyingAssetCode: assetCodeOf(
          op.selling_asset_type,
          op.selling_asset_code,
        ),
        price: amountOf(op.price),
      };
    case "liquidity_pool_deposit":
    case "liquidity_pool_withdraw":
      return { ...base, from: op.source_account, toHint: "liquidity pool" };
    case "create_claimable_balance":
      return {
        ...base,
        from: op.source_account,
        toHint: "claimable balance",
        amount: amountOf(op.amount),
        assetCode: claimableCodeOf(op.asset),
      };
    case "claim_claimable_balance":
      return { ...base, from: op.source_account, toHint: "claimable balance" };
    case "clawback":
      return {
        ...base,
        from: op.from,
        to: op.source_account,
        amount: amountOf(op.amount),
        assetCode: assetCodeOf(op.asset_type, op.asset_code),
      };
    case "set_trust_line_flags":
    case "allow_trust":
      return { ...base, from: op.source_account, to: op.trustor };
    case "change_trust": {
      const to = op.trustee ?? op.asset_issuer;
      return {
        ...base,
        from: op.trustor ?? op.source_account,
        to,
        toHint: to === undefined ? "liquidity pool" : undefined,
        assetCode: assetCodeOf(op.asset_type, op.asset_code),
        limit: amountOf(op.limit),
      };
    }
    case "extend_footprint_ttl":
    case "restore_footprint":
      return { ...base, from: op.source_account, toHint: "contract storage" };
    case "set_options":
    case "manage_data":
    case "bump_sequence":
      return { ...base, from: op.source_account, toHint: "own account" };
    default:
      return { ...base, from: op.source_account };
  }
}

/**
 * Pairs each transaction with its first operation so the feed can show
 * what a transaction does. Operations come from a separate lookback
 * window; a transaction whose operations fall outside it renders
 * without the presentation and stays a plain row.
 */
const HASH_SHAPE = /^[0-9a-f]{64}$/;

export function buildActivityRows(
  txs: TxRecord[],
  ops: OperationRecord[],
): ActivityRow[] {
  const primaryByTx = new Map<string, OperationRecord>();
  for (const op of ops) {
    const current = primaryByTx.get(op.transaction_hash);
    // paging tokens of one tx share a length, so string order is numeric
    if (current === undefined || op.paging_token < current.paging_token) {
      primaryByTx.set(op.transaction_hash, op);
    }
  }
  // a hash that is not hex-64 is provider garbage; it must never be
  // rendered, linked, copied, or interpolated into a request path
  return txs
    .filter((tx) => HASH_SHAPE.test(tx.hash))
    .map((tx) => {
      const op = primaryByTx.get(tx.hash);
      return op === undefined ? { tx } : { tx, op: presentOperation(op) };
    });
}
