import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Address } from "@/components/address";
import { LogoMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchLatestLedgers, type LedgerRecord } from "@/lib/horizon/client";
import {
  averageCloseSeconds,
  useHorizonStream,
  type StreamStatus,
} from "@/lib/live";
import { ACTIVE_NETWORK, appPath } from "@/lib/network";
import { healthQuery, latestTransactionsQuery } from "@/lib/queries";

const LEDGER_CAP = 6;
const TX_CAP = 8;

const ledgerOptions = {
  path: "/ledgers",
  cap: LEDGER_CAP,
  fetchInitial: (signal: AbortSignal) =>
    fetchLatestLedgers(ACTIVE_NETWORK, LEDGER_CAP, signal).then(
      (page) => page._embedded.records,
    ),
  keyOf: (record: LedgerRecord) => record.paging_token,
};

function timeOf(iso: string): string {
  return iso.slice(11, 19);
}

function LiveDot({ status }: { status: StreamStatus }) {
  if (status === "paused") {
    return (
      <span className="text-xs text-muted-foreground">live updates paused</span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={
          status === "live"
            ? "size-2 animate-pulse rounded-full bg-emerald-500"
            : "size-2 rounded-full bg-muted-foreground"
        }
        aria-hidden="true"
      />
      {status === "live" ? "live" : "connecting"}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="font-mono text-2xl font-bold tabular-nums">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

export function HomePage() {
  const health = useQuery(healthQuery(ACTIVE_NETWORK));
  const ledgers = useHorizonStream(ACTIVE_NETWORK, ledgerOptions);
  const txQuery = useQuery(latestTransactionsQuery(ACTIVE_NETWORK, TX_CAP));
  const txRecords = txQuery.data?._embedded.records ?? [];
  const txStatus: StreamStatus = txQuery.isError
    ? "paused"
    : txQuery.isPending
      ? "connecting"
      : "live";

  const head = ledgers.records[0];
  const closeSeconds = averageCloseSeconds(
    ledgers.records.map((record) => record.closed_at),
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <section className="flex flex-col items-center gap-3 py-6 text-center">
        <LogoMark size={56} />
        <h1 className="text-4xl font-bold tracking-tight">Soroscan</h1>
        <p className="text-muted-foreground">
          A Stellar block explorer with a modern, contract-first UI.
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">pre-alpha</Badge>
          {health.isPending ? (
            <Skeleton className="h-[22px] w-36 rounded-full" />
          ) : health.isError ? (
            <Badge variant="outline" className="text-muted-foreground">
              network unreachable
            </Badge>
          ) : (
            <Badge variant="outline" className="font-mono tabular-nums">
              ledger {health.data.latestLedger.toLocaleString("en-US")}
            </Badge>
          )}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Latest ledger"
          value={
            head ? (
              Number(head.sequence).toLocaleString("en-US")
            ) : (
              <Skeleton className="h-8 w-32" />
            )
          }
        />
        <Stat
          label="Avg close time"
          value={
            closeSeconds !== undefined ? (
              `${closeSeconds}s`
            ) : (
              <Skeleton className="h-8 w-16" />
            )
          }
        />
        <Stat
          label="Transactions in last ledger"
          value={
            head ? (
              `${head.successful_transaction_count + head.failed_transaction_count}`
            ) : (
              <Skeleton className="h-8 w-16" />
            )
          }
        />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent ledgers</CardTitle>
            <LiveDot status={ledgers.status} />
          </CardHeader>
          <CardContent>
            {ledgers.records.length === 0 ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <ul>
                {ledgers.records.map((ledger) => (
                  <li
                    key={ledger.paging_token}
                    className="flex items-baseline justify-between gap-3 border-b py-2 text-sm last:border-b-0"
                  >
                    <Link
                      to={appPath(`/ledger/${ledger.sequence}`)}
                      className="font-mono tabular-nums underline-offset-4 hover:underline"
                    >
                      {Number(ledger.sequence).toLocaleString("en-US")}
                    </Link>
                    <span className="text-muted-foreground">
                      {ledger.successful_transaction_count +
                        ledger.failed_transaction_count}{" "}
                      tx, {ledger.operation_count} ops
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {timeOf(ledger.closed_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent transactions</CardTitle>
            <LiveDot status={txStatus} />
          </CardHeader>
          <CardContent>
            {txRecords.length === 0 ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <ul>
                {txRecords.map((tx) => (
                  <li
                    key={tx.paging_token}
                    className="flex items-center gap-3 border-b py-2 text-sm last:border-b-0"
                  >
                    <span
                      className={
                        tx.successful
                          ? "size-2 shrink-0 rounded-full bg-emerald-500"
                          : "size-2 shrink-0 rounded-full bg-red-500"
                      }
                      aria-hidden="true"
                    />
                    <span className="sr-only">
                      {tx.successful ? "succeeded" : "failed"}
                    </span>
                    <Link
                      to={appPath(`/tx/${tx.hash}`)}
                      className="font-mono underline-offset-4 hover:underline"
                    >
                      {tx.hash.slice(0, 4)}...{tx.hash.slice(-4)}
                    </Link>
                    <span className="hidden text-muted-foreground sm:inline">
                      <Address value={tx.source_account} />
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {tx.operation_count} op
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {timeOf(tx.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
