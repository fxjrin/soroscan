import type { ReactNode } from "react";
import { Link } from "react-router";
import { Address } from "@/components/address";
import { DataCell, DataRow, DataTable, NoValue } from "@/components/data-table";
import { ScValView } from "@/components/scval-view";
import { truncateMiddle } from "@/lib/format";
import { appPath } from "@/lib/network";
import type { TraceStateChange, TraceTtl } from "@/lib/tx-trace";

export function TraceSectionLabel({ children }: { children: ReactNode }) {
  return <p className="pb-2 pt-5 font-medium text-foreground/80">{children}</p>;
}

const STATE_CHANGE_STYLES: Record<TraceStateChange["kind"], string> = {
  created: "text-emerald-700 dark:text-emerald-400",
  updated: "text-muted-foreground",
  restored: "text-sky-700 dark:text-sky-400",
  removed: "text-red-600 dark:text-red-400",
};

/** A state change's kind, colored by what it did: wrote, touched, or dropped. */
export function StateChangeKind({ kind }: { kind: TraceStateChange["kind"] }) {
  return <span className={STATE_CHANGE_STYLES[kind]}>{kind}</span>;
}

function StateChangeRow({ change }: { change: TraceStateChange }) {
  return (
    <DataRow>
      <DataCell>
        <StateChangeKind kind={change.kind} />
      </DataCell>
      <DataCell>
        {change.contract ? <Address value={change.contract} /> : <NoValue />}
      </DataCell>
      <DataCell>
        {change.key ? (
          <code className="font-mono">
            <ScValView value={change.key} />
          </code>
        ) : (
          <NoValue />
        )}
      </DataCell>
      <DataCell>
        {change.value ? (
          <code className="font-mono">
            <ScValView value={change.value} />
          </code>
        ) : (
          <NoValue />
        )}
      </DataCell>
      <DataCell>
        {change.durability ? (
          <span className="text-muted-foreground">{change.durability}</span>
        ) : (
          <NoValue />
        )}
      </DataCell>
    </DataRow>
  );
}

function TtlRow({ ttl }: { ttl: TraceTtl }) {
  return (
    <DataRow>
      <DataCell>
        {ttl.contract ? <Address value={ttl.contract} /> : <NoValue />}
      </DataCell>
      <DataCell>
        <span className="text-muted-foreground">{ttl.entry ?? "ledger"}</span>
      </DataCell>
      <DataCell className="font-mono text-muted-foreground">
        {truncateMiddle(ttl.keyHash, 8)}
      </DataCell>
      <DataCell numeric>
        <Link
          to={appPath(`/ledger/${ttl.liveUntilLedger}`)}
          className="font-mono text-link transition-colors hover:text-link-hover"
        >
          {ttl.liveUntilLedger.toLocaleString("en-US")}
        </Link>
      </DataCell>
    </DataRow>
  );
}

/**
 * What a transaction wrote to storage and how long it asked the ledger to
 * keep it. Changes come from the meta as one flat list for the whole
 * transaction, not tagged with which call made them the way calls and
 * events are, so this shows all of it rather than picking a call to blame.
 */
export function TraceStorageChanges({
  stateChanges,
  ttlExtensions,
}: {
  stateChanges: TraceStateChange[];
  ttlExtensions: TraceTtl[];
}) {
  return (
    <>
      {stateChanges.length > 0 ? (
        <>
          <TraceSectionLabel>State changes</TraceSectionLabel>
          <DataTable
            minWidth="min-w-[52rem]"
            columns={[
              { label: "Change" },
              { label: "Contract" },
              { label: "Key" },
              { label: "Value" },
              { label: "Durability" },
            ]}
          >
            {stateChanges.map((change, index) => (
              <StateChangeRow key={index} change={change} />
            ))}
          </DataTable>
        </>
      ) : null}
      {ttlExtensions.length > 0 ? (
        <>
          <TraceSectionLabel>Storage lifetime</TraceSectionLabel>
          <DataTable
            minWidth="min-w-[44rem]"
            columns={[
              { label: "Contract" },
              { label: "Entry" },
              { label: "Key hash" },
              { label: "Live until ledger", numeric: true },
            ]}
          >
            {ttlExtensions.map((ttl, index) => (
              <TtlRow key={index} ttl={ttl} />
            ))}
          </DataTable>
        </>
      ) : null}
    </>
  );
}
