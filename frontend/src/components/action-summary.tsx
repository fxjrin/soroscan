import type { ReactNode } from "react";
import { Address } from "@/components/address";
import { AssetIcon } from "@/components/asset-icon";
import { FunctionChip } from "@/components/op-tag";
import { formatDecimalDisplay } from "@/lib/format";
import type { PrimaryOp } from "@/lib/activity";

/** An asset named in a sentence: the amount, its icon, and its code. */
function AssetMention({
  amount,
  code,
  issuer,
}: {
  amount?: string;
  code: string;
  issuer?: string;
}) {
  return (
    // the literal spaces cost the flex layout nothing and keep the
    // sentence reading as words when selected, copied, or matched
    <span className="flex items-center gap-1.5">
      {amount === undefined ? null : <span>{amount}</span>}{" "}
      <AssetIcon code={code} issuer={issuer} />
      <span>{code}</span>
    </span>
  );
}
/**
 * One human sentence for what an operation did, blockscout-style, built from
 * the decoded operation. Every piece is a direct flex item so word gaps and
 * vertical centering stay uniform across the sentence.
 */
export function ActionSummary({
  op,
  opCount = 1,
}: {
  op: PrimaryOp;
  /** how many operations the transaction carries, when there are more */
  opCount?: number;
}) {
  const amount =
    op.amount === undefined ? undefined : formatDecimalDisplay(op.amount);
  const sourceAmount =
    op.sourceAmount === undefined
      ? undefined
      : formatDecimalDisplay(op.sourceAmount);

  let action: ReactNode;
  switch (op.type) {
    case "payment":
      action =
        amount && op.assetCode && op.to ? (
          <>
            <span>sent</span>{" "}
            <AssetMention
              amount={amount}
              code={op.assetCode}
              issuer={op.assetIssuer}
            />{" "}
            <span>to</span>
            <Address value={op.to} />
          </>
        ) : (
          <span>sent a payment</span>
        );
      break;
    // one asset in, another out. Landing back on the sender makes it a
    // swap; landing elsewhere makes it a payment funded by a conversion
    case "path_payment_strict_send":
    case "path_payment_strict_receive": {
      const swap =
        sourceAmount &&
        op.sourceAssetCode &&
        amount &&
        op.assetCode &&
        op.sourceAssetCode !== op.assetCode;
      const via =
        op.hops === undefined || op.hops === 0
          ? null
          : ` via ${op.hops} ${op.hops === 1 ? "hop" : "hops"}`;
      action = swap ? (
        <>
          <span>swapped</span>{" "}
          <AssetMention
            amount={sourceAmount}
            code={op.sourceAssetCode ?? ""}
            issuer={op.sourceAssetIssuer}
          />{" "}
          <span>for</span>
          <AssetMention
            amount={amount}
            code={op.assetCode ?? ""}
            issuer={op.assetIssuer}
          />{" "}
          {via === null ? null : <span>{via.trim()}</span>}
          {op.to !== undefined && op.to !== op.from ? (
            <>
              <span>to</span>
              <Address value={op.to} />
            </>
          ) : null}
        </>
      ) : amount && op.assetCode && op.to ? (
        <>
          <span>sent</span>
          <AssetMention
            amount={amount}
            code={op.assetCode}
            issuer={op.assetIssuer}
          />
          <span>to</span>
          <Address value={op.to} />
        </>
      ) : (
        <span>sent a payment</span>
      );
      break;
    }
    // a trustline is the account agreeing to hold an asset, up to a
    // ceiling; a ceiling of zero retires the line instead
    case "change_trust": {
      // a pool share trustline names no asset of its own
      const asset = op.assetCode ?? (op.toHint ? "a pool share" : undefined);
      action =
        asset === undefined ? (
          <span>changed a trustline</span>
        ) : op.limit === "0" ? (
          <>
            <span>removed the</span>
            {op.assetCode === undefined ? (
              <span>{asset}</span>
            ) : (
              <AssetMention code={op.assetCode} issuer={op.assetIssuer} />
            )}
            <span>trustline</span>
            {op.to ? (
              <>
                <span>issued by</span>
                <Address value={op.to} />
              </>
            ) : null}
          </>
        ) : (
          <>
            <span>trusted</span>
            {op.assetCode === undefined ? (
              <span>{asset}</span>
            ) : (
              <AssetMention code={op.assetCode} issuer={op.assetIssuer} />
            )}
            {op.limit === undefined ? null : (
              <span>{`up to ${formatDecimalDisplay(op.limit)}`}</span>
            )}
            {op.to ? (
              <>
                <span>from</span>
                <Address value={op.to} />
              </>
            ) : null}
          </>
        );
      break;
    }
    // an offer names both sides and the rate between them
    case "manage_sell_offer":
    case "create_passive_sell_offer":
    case "manage_buy_offer":
      action =
        amount && op.assetCode && op.buyingAssetCode ? (
          <>
            <span>
              {op.type === "manage_buy_offer" ? "offered to buy" : "offered"}
            </span>
            <AssetMention
              amount={amount}
              code={op.assetCode}
              issuer={op.assetIssuer}
            />
            <span>{op.type === "manage_buy_offer" ? "with" : "for"}</span>
            <AssetMention
              code={op.buyingAssetCode}
              issuer={op.buyingAssetIssuer}
            />
            {op.price === undefined ? null : (
              <span>{`at ${formatDecimalDisplay(op.price)}`}</span>
            )}
          </>
        ) : (
          <span>placed a DEX offer</span>
        );
      break;
    case "invoke_host_function":
      action = (
        <>
          <span>called</span>
          {op.detail ? (
            <FunctionChip name={op.detail} />
          ) : (
            <span className="font-mono">a function</span>
          )}
          <span>on</span>
          {op.to ? <Address value={op.to} /> : <span>a contract</span>}
        </>
      );
      break;
    case "create_account":
      action =
        op.to && op.amount ? (
          <>
            <span>created account</span>
            <Address value={op.to} />
            <span>with</span>
            <AssetMention amount={formatDecimalDisplay(op.amount)} code="XLM" />
          </>
        ) : (
          <span>created an account</span>
        );
      break;
    default:
      action = <span>{`performed ${op.label.toLowerCase()}`}</span>;
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {op.from ? <Address value={op.from} /> : null}
      {action}
      {opCount > 1 ? (
        <span className="text-muted-foreground">
          and {opCount - 1} more {opCount === 2 ? "operation" : "operations"}
        </span>
      ) : null}
    </p>
  );
}
