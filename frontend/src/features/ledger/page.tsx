import { useEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Address } from "@/components/address";
import { EntityShell, Row } from "@/features/entity-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { InvalidEntity } from "@/features/invalid-entity";
import { formatAgo, formatTimestamp } from "@/lib/format";
import { NotFoundError } from "@/lib/horizon/client";
import { ACTIVE_NETWORK } from "@/lib/network";
import { healthQuery, ledgerQuery } from "@/lib/queries";
import { classifySearch } from "@/lib/search";
import { useNow } from "@/lib/use-now";

const MAX_LEDGER_SEQUENCE = 4294967295; // u32, per the ledger header

// every row a closed ledger has is known up front, so the placeholder is
// the same list with bars where the values will be
function ValueBar({ className }: { className?: string }) {
  return (
    <span className="flex h-[1lh] items-center">
      <Skeleton className={cn("h-5", className)} />
    </span>
  );
}

function LedgerSkeleton() {
  return (
    <dl>
      <Row label="Closed at">
        <ValueBar className="w-64" />
      </Row>
      <Row label="Transactions">
        <ValueBar className="w-48" />
      </Row>
      <Row label="Operations">
        <ValueBar className="w-10" />
      </Row>
      <Row label="Protocol">
        <ValueBar className="w-8" />
      </Row>
      <Row label="Hash">
        <ValueBar className="w-full max-w-[34rem]" />
      </Row>
    </dl>
  );
}

export function LedgerPage() {
  const now = useNow();
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
    body = <LedgerSkeleton />;
  } else if (ledger.isSuccess) {
    body = (
      <dl>
        <Row label="Closed at">
          {formatAgo(ledger.data.closed_at, now)}{" "}
          <span className="text-muted-foreground">
            {formatTimestamp(ledger.data.closed_at)}
          </span>
        </Row>
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
      body = <LedgerSkeleton />;
    } else if (seq > latest) {
      body = (
        <p className="text-muted-foreground">
          This ledger has not closed yet; the network is currently at ledger{" "}
          <span className="font-mono">{latest.toLocaleString("en-US")}</span>.
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
      identifier={<span className="font-mono">{target.value}</span>}
    >
      {body}
    </EntityShell>
  );
}
