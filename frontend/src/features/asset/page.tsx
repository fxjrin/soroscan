import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Address } from "@/components/address";
import { AssetIcon } from "@/components/asset-icon";
import { UntrustedText } from "@/components/untrusted-text";
import { useAssetMeta } from "@/lib/asset-meta";
import { EntityShell, Row, ValueBar } from "@/features/entity-shell";
import { InvalidEntity } from "@/features/invalid-entity";
import { formatDecimalDisplay } from "@/lib/format";
import {
  fetchAssetStat,
  fetchLatestLedgers,
  NotFoundError,
  type AssetStatRecord,
} from "@/lib/horizon/client";
import { ACTIVE_NETWORK, appPath } from "@/lib/network";

const CODE_SHAPE = /^[A-Za-z0-9]{1,12}$/;
const ISSUER_SHAPE = /^G[A-Z2-7]{55}$/;

interface AssetRef {
  code: string;
  issuer?: string;
}

// the url form is XLM for the native asset, CODE-GISSUER for everything
// else; the code alphabet has no dash, so the first dash is the split
function parseAssetParam(raw: string): AssetRef | undefined {
  if (raw === "XLM") {
    return { code: "XLM" };
  }
  const dash = raw.indexOf("-");
  if (dash === -1) {
    return undefined;
  }
  const code = raw.slice(0, dash);
  const issuer = raw.slice(dash + 1);
  if (!CODE_SHAPE.test(code) || !ISSUER_SHAPE.test(issuer)) {
    return undefined;
  }
  return { code, issuer };
}

const FLAG_LABELS: Array<
  [keyof NonNullable<AssetStatRecord["flags"]>, string]
> = [
  ["auth_required", "authorization required"],
  ["auth_revocable", "revocable"],
  ["auth_immutable", "immutable"],
  ["auth_clawback_enabled", "clawback enabled"],
];

function AmountValue({ value }: { value?: string }) {
  if (value === undefined) {
    return <span className="text-muted-foreground">unknown</span>;
  }
  return <span className="font-mono">{formatDecimalDisplay(value)}</span>;
}

function NativeDetails() {
  const ledgers = useQuery({
    queryKey: ["latest-ledger-supply", ACTIVE_NETWORK],
    queryFn: ({ signal }) => fetchLatestLedgers(ACTIVE_NETWORK, 1, signal),
    staleTime: 60 * 1000,
  });
  const totalCoins = ledgers.data?._embedded.records[0]?.total_coins;
  return (
    <dl className="divide-y divide-border">
      <Row
        label="Total supply"
        hint="Every lumen in existence, as the latest closed ledger counts it. New lumens are no longer created; the supply only shrinks when fees are burned."
      >
        {ledgers.isPending ? (
          <ValueBar className="w-40" />
        ) : totalCoins === undefined ? (
          <span className="text-muted-foreground">unknown</span>
        ) : (
          <span className="font-mono">
            {formatDecimalDisplay(totalCoins)} XLM
          </span>
        )}
      </Row>
      <Row
        label="Asset type"
        hint="The lumen is the network's native asset: it pays fees and reserves, and no account issues it."
      >
        native
      </Row>
    </dl>
  );
}

function IssuedDetails({ code, issuer }: { code: string; issuer: string }) {
  const stat = useQuery({
    queryKey: ["asset-stat", ACTIVE_NETWORK, code, issuer],
    queryFn: ({ signal }) =>
      fetchAssetStat(ACTIVE_NETWORK, code, issuer, signal),
    staleTime: 60 * 1000,
  });

  if (stat.isPending) {
    return (
      <dl className="divide-y divide-border">
        {["Issuer", "Holders", "Amount held", "Flags"].map((label) => (
          <Row key={label} label={label}>
            <ValueBar className="w-48" />
          </Row>
        ))}
      </dl>
    );
  }
  if (stat.error instanceof NotFoundError) {
    return (
      <p className="text-muted-foreground">
        No account holds a trustline to this asset, so the ledger keeps no
        statistics for it.
      </p>
    );
  }
  if (!stat.isSuccess) {
    return (
      <p className="text-muted-foreground">
        Could not load this asset; the data providers are unreachable.
      </p>
    );
  }

  const record = stat.data;
  const flags = FLAG_LABELS.filter(([key]) => record.flags?.[key] === true).map(
    ([, label]) => label,
  );
  return (
    <dl className="divide-y divide-border">
      <Row
        label="Issuer"
        hint="The account that created this asset and can issue more of it. The issuer plus the code is what makes an asset unique; anyone can issue an asset with the same code."
      >
        <Address value={issuer} />
      </Row>
      {record.contract_id === undefined ? null : (
        <Row
          label="Contract"
          hint="The Stellar Asset Contract for this asset, which lets smart contracts hold and move it."
        >
          <Link
            to={appPath(`/contract/${record.contract_id}`)}
            className="break-all font-mono text-link transition-colors hover:text-link-hover"
          >
            {record.contract_id}
          </Link>
        </Row>
      )}
      <Row
        label="Holders"
        hint="Accounts holding an authorized trustline to this asset. Balances inside contracts are counted separately below."
      >
        <span className="font-mono">
          {record.accounts?.authorized?.toLocaleString("en-US") ?? "unknown"}
        </span>
      </Row>
      <Row
        label="Amount held"
        hint="The total sitting in authorized trustlines. The issuer can always issue more, so this is circulation, not a cap."
      >
        <AmountValue value={record.balances?.authorized} />
      </Row>
      {record.num_contracts === undefined ||
      record.num_contracts === 0 ? null : (
        <Row
          label="In contracts"
          hint="The amount held by smart contracts, and how many contracts hold it."
        >
          <span className="flex flex-wrap items-center gap-x-2">
            <AmountValue value={record.contracts_amount} />
            <span className="text-muted-foreground">
              across {record.num_contracts.toLocaleString("en-US")} contracts
            </span>
          </span>
        </Row>
      )}
      {record.num_liquidity_pools === undefined ||
      record.num_liquidity_pools === 0 ? null : (
        <Row
          label="In liquidity pools"
          hint="The amount deposited into on-chain liquidity pools."
        >
          <span className="flex flex-wrap items-center gap-x-2">
            <AmountValue value={record.liquidity_pools_amount} />
            <span className="text-muted-foreground">
              across {record.num_liquidity_pools.toLocaleString("en-US")} pools
            </span>
          </span>
        </Row>
      )}
      <Row
        label="Flags"
        hint="Controls the issuer set on the asset: whether holders need approval, whether access can be revoked, and whether the issuer can claw back balances."
      >
        {flags.length === 0 ? (
          <span className="text-muted-foreground">none</span>
        ) : (
          flags.join(", ")
        )}
      </Row>
    </dl>
  );
}

export function AssetPage() {
  const { asset: raw = "" } = useParams();
  const ref = parseAssetParam(raw);
  const meta = useAssetMeta(ref?.code ?? "", ref?.issuer);

  if (ref === undefined) {
    return <InvalidEntity expected="asset" value={raw} />;
  }

  let identity: ReactNode = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <AssetIcon code={ref.code} issuer={ref.issuer} size={28} />
      {meta?.name === undefined ? null : (
        <UntrustedText value={meta.name} maxLength={64} className="text-lg" />
      )}
      {meta === undefined ? null : (
        <a
          href={`https://${meta.domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link transition-colors hover:text-link-hover"
        >
          <UntrustedText value={meta.domain} maxLength={40} />
        </a>
      )}
    </span>
  );
  if (meta?.description !== undefined) {
    identity = (
      <span className="flex flex-col gap-2">
        {identity}
        <UntrustedText
          value={meta.description}
          maxLength={400}
          className="max-w-prose text-pretty text-muted-foreground"
        />
      </span>
    );
  }

  return (
    <EntityShell title={ref.code} identifier={identity}>
      {ref.issuer === undefined ? (
        <NativeDetails />
      ) : (
        <IssuedDetails code={ref.code} issuer={ref.issuer} />
      )}
    </EntityShell>
  );
}
