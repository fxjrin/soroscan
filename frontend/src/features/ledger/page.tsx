import { useEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Address } from "@/components/address";
import { Skeleton } from "@/components/ui/skeleton";
import { EntityShell } from "@/features/entity-shell";
import { InvalidEntity } from "@/features/invalid-entity";
import { NotFoundError } from "@/lib/horizon/client";
import { ACTIVE_NETWORK } from "@/lib/network";
import { healthQuery, ledgerQuery } from "@/lib/queries";
import { classifySearch } from "@/lib/search";

const MAX_LEDGER_SEQUENCE = 4294967295; // u32, per the ledger header

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-1.5">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{children}</dd>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-5 w-56" />
    </div>
  );
}

export function LedgerPage() {
  const { sequence = "" } = useParams();
  const target = classifySearch(sequence);
  const valid =
    target.type === "ledger" && Number(target.value) <= MAX_LEDGER_SEQUENCE;
  const seq = Number(target.value);

  const ledger = useQuery({
    ...ledgerQuery(ACTIVE_NETWORK, target.value),
    enabled: valid,
  });
  const health = useQuery({
    ...healthQuery(ACTIVE_NETWORK),
    enabled: valid && ledger.isError,
  });

  const latest = health.data?.latestLedger;
  const notFound = ledger.error instanceof NotFoundError;
  const sawFuture = useRef(false);
  const refetch = ledger.refetch;
  useEffect(() => {
    if (!notFound || latest === undefined) {
      return;
    }
    if (seq > latest) {
      sawFuture.current = true;
      return;
    }
    if (sawFuture.current) {
      sawFuture.current = false;
      void refetch(); // the network reached this sequence; the 404 is stale now
    }
  }, [notFound, latest, seq, refetch]);

  if (!valid) {
    return <InvalidEntity expected="ledger sequence" value={sequence} />;
  }

  let body: ReactNode;
  if (ledger.isPending || (notFound && ledger.isFetching)) {
    body = <LoadingRows />;
  } else if (ledger.isSuccess) {
    body = (
      <dl>
        <Row label="Closed at">{ledger.data.closed_at}</Row>
        <Row label="Transactions">
          {ledger.data.successful_transaction_count} succeeded,{" "}
          {ledger.data.failed_transaction_count} failed
        </Row>
        <Row label="Operations">{ledger.data.operation_count}</Row>
        <Row label="Protocol">{ledger.data.protocol_version}</Row>
        <Row label="Hash">
          <Address value={ledger.data.hash} />
        </Row>
      </dl>
    );
  } else if (notFound) {
    if (latest === undefined) {
      body = <LoadingRows />;
    } else if (seq > latest) {
      body = (
        <p className="text-muted-foreground">
          This ledger has not closed yet; the network is currently at ledger{" "}
          <span className="font-mono tabular-nums">
            {latest.toLocaleString("en-US")}
          </span>
          .
        </p>
      );
    } else {
      body = (
        <p className="text-muted-foreground">
          This ledger is older than the data provider's available history.
        </p>
      );
    }
  } else {
    body = (
      <p className="text-muted-foreground">
        Could not load this ledger; the data providers are unreachable.
      </p>
    );
  }

  return (
    <EntityShell
      title="Ledger"
      identifier={
        <span className="font-mono tabular-nums">{target.value}</span>
      }
    >
      {body}
    </EntityShell>
  );
}
