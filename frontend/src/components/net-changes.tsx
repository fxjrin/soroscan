import { Address } from "@/components/address";
import { AssetLink } from "@/components/asset-link";
import {
  netBalanceChanges,
  type NetBalanceChange,
} from "@/lib/balance-changes";
import type { EffectRecord } from "@/lib/horizon/client";

/** One holder's total for one asset: who, how much, and which way it went. */
export function NetChangeLine({ change }: { change: NetBalanceChange }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Address value={change.holder} />
      <span
        className={
          change.amount.startsWith("-")
            ? "inline-flex items-center gap-1.5 font-mono text-red-600 dark:text-red-400"
            : "inline-flex items-center gap-1.5 font-mono text-emerald-700 dark:text-emerald-400"
        }
      >
        <span>
          {change.amount.startsWith("-") ? "" : "+"}
          {change.amount}
        </span>{" "}
        <AssetLink
          code={change.assetCode}
          issuer={change.assetIssuer}
          showDomain={false}
        />
      </span>
      {change.assetIssuer ? (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          issued by
          <Address value={change.assetIssuer} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * What a transaction left behind, per holder and asset, settled from its
 * effects. Horizon keeps effects for good, so this answers what moved even
 * for a transaction whose execution meta has aged out of RPC retention.
 */
export function NetChanges({ effects }: { effects: EffectRecord[] }) {
  const changes = netBalanceChanges(effects);
  if (changes.length === 0) {
    return null;
  }
  return (
    <>
      <p className="pb-2 font-medium text-foreground/80">Net change</p>
      <ul className="flex flex-col gap-1.5 pb-5">
        {changes.map((change) => (
          <li
            key={change.holder + change.assetCode + (change.assetIssuer ?? "")}
          >
            <NetChangeLine change={change} />
          </li>
        ))}
      </ul>
    </>
  );
}

// an effect names the operation it came out of; in a transaction that
// runs several operations this is the only per-effect field that varies
