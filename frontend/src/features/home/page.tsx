import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowRightLeft,
  FileCode2,
  Layers,
  Settings2,
  UserRound,
} from "lucide-react";
import { Address } from "@/components/address";
import { CopyButton } from "@/components/copy-button";
import { AssetIcon } from "@/components/asset-icon";
import { InfoHint } from "@/components/info-hint";
import { LedgerPulse } from "@/components/ledger-pulse";
import { LogoMark } from "@/components/logo";
import { PopNumber } from "@/components/pop-number";
import { SearchBox } from "@/components/search-box";
import { TxActivityChart } from "@/components/tx-activity-chart";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatAgo,
  formatAmount,
  formatDecimalDisplay,
  formatXlmDisplay,
  subtractDecimalStrings,
} from "@/lib/format";
import { fetchLatestLedgers, type LedgerRecord } from "@/lib/horizon/client";
import {
  averageCloseSeconds,
  useHorizonStream,
  type StreamStatus,
} from "@/lib/live";
import { ACTIVE_NETWORK, appPath } from "@/lib/network";
import { feeStatsQuery, healthQuery, latestActivityQuery } from "@/lib/queries";
import type { OpFamily } from "@/lib/activity";
import { chainNow } from "@/lib/clock";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const CHART_WINDOW = 60; // ~5 minutes of ledgers feeds the chart and the stats
const LEDGER_ROWS = 5;
const TX_ROWS = 8;

const ledgerOptions = {
  path: "/ledgers",
  cap: CHART_WINDOW,
  fetchInitial: (signal: AbortSignal) =>
    fetchLatestLedgers(ACTIVE_NETWORK, CHART_WINDOW, signal).then(
      (page) => page._embedded.records,
    ),
  keyOf: (record: LedgerRecord) => record.paging_token,
};

function throughput(records: LedgerRecord[]): string | undefined {
  if (records.length < 2) {
    return undefined;
  }
  const txs = records.reduce(
    (sum, record) =>
      sum +
      record.successful_transaction_count +
      record.failed_transaction_count,
    0,
  );
  const seconds =
    (Date.parse(records[0].closed_at) -
      Date.parse(records[records.length - 1].closed_at)) /
    1000;
  return seconds > 0 ? (txs / seconds).toFixed(1) : undefined;
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
            ? "live-dot size-2 rounded-full bg-emerald-500"
            : "size-2 rounded-full bg-muted-foreground"
        }
        aria-hidden="true"
      />
      {status === "live" ? "live" : "connecting"}
    </span>
  );
}

function Stat({
  label,
  value,
  sub,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-mono text-xl font-bold leading-none tabular-nums">
        {value}
      </div>
      {sub ? (
        <div className="font-mono text-xs tabular-nums text-muted-foreground">
          {sub}
        </div>
      ) : null}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {hint ? <InfoHint>{hint}</InfoHint> : null}
      </div>
    </div>
  );
}

function FeedNotice({
  height,
  children,
}: {
  height: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-center text-sm text-muted-foreground",
        height,
      )}
    >
      {children}
    </div>
  );
}

const FAMILY_ICONS: Record<OpFamily, typeof ArrowRightLeft> = {
  transfer: ArrowRightLeft,
  contract: ArrowRightLeft,
  dex: ArrowDownUp,
  config: Settings2,
  other: ArrowRightLeft,
};

// C and M addresses are executable or muxed targets, G is a person's key
function entityIconFor(address: string) {
  return address.startsWith("G") ? UserRound : FileCode2;
}

const TAG_STYLES: Record<OpFamily, string> = {
  transfer: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  contract: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  dex: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  config: "bg-muted text-muted-foreground",
  other: "bg-muted text-muted-foreground",
};

function OpTag({
  family,
  children,
}: {
  family: OpFamily;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-[3px] px-1.5 py-0.5 text-[11px] font-medium leading-none",
        TAG_STYLES[family],
      )}
    >
      {children}
    </span>
  );
}

export function HomePage() {
  const now = useNow();
  const health = useQuery(healthQuery(ACTIVE_NETWORK));
  const fees = useQuery(feeStatsQuery(ACTIVE_NETWORK));
  const ledgers = useHorizonStream(ACTIVE_NETWORK, ledgerOptions);
  const txQuery = useQuery(latestActivityQuery(ACTIVE_NETWORK, TX_ROWS));

  const streamHead = ledgers.records[0];
  const healthSeq = health.data?.latestLedger;
  const healthCloseMs = health.data
    ? Number(health.data.latestLedgerCloseTime) * 1000
    : undefined;
  const healthIsAhead =
    healthSeq !== undefined &&
    healthCloseMs !== undefined &&
    Number.isFinite(healthCloseMs) &&
    (streamHead === undefined || healthSeq > streamHead.sequence);
  const displaySeq = healthIsAhead ? healthSeq : streamHead?.sequence;

  const [arrival, setArrival] = useState<{
    seq: number;
    atMs: number;
    fromProgress: number;
  } | null>(null);
  const closeSeconds = averageCloseSeconds(
    ledgers.records.slice(0, 6).map((record) => record.closed_at),
  );
  if (
    displaySeq !== undefined &&
    (arrival === null || displaySeq > arrival.seq)
  ) {
    // render-phase adjust: the ring restarts at the arrival instant; a
    // provider reporting an older height never rewinds it
    const nowMs = chainNow();
    const previousProgress = arrival
      ? Math.min(1, (nowMs - arrival.atMs) / 1000 / (closeSeconds ?? 5.5))
      : 0;
    setArrival({
      seq: displaySeq,
      atMs: nowMs,
      fromProgress: previousProgress,
    });
  }

  const refetchTxs = txQuery.refetch;
  useEffect(() => {
    if (displaySeq !== undefined) {
      void refetchTxs(); // beat the tx feed in step with ledger arrival
    }
  }, [displaySeq, refetchTxs]);

  const latestTxs = txQuery.data ?? [];
  const txStatus: StreamStatus = txQuery.isError
    ? "paused"
    : txQuery.isPending
      ? "connecting"
      : "live";

  const [seedTokens, setSeedTokens] = useState<Set<string> | null>(null);
  if (seedTokens === null && ledgers.records.length > 0) {
    // rows present at first paint enter with the list, not one by one
    setSeedTokens(
      new Set(ledgers.records.map((record) => record.paging_token)),
    );
  }

  const head = ledgers.records[0];
  const tps = throughput(ledgers.records);
  const peak =
    ledgers.records.length > 0
      ? Math.max(
          ...ledgers.records.map(
            (record) =>
              record.successful_transaction_count +
              record.failed_transaction_count,
          ),
        )
      : undefined;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 pt-4 text-center">
        <div className="flex items-center gap-3">
          <LogoMark size={48} />
          <h1 className="-translate-y-1 text-5xl font-bold tracking-tight">
            soroscan
          </h1>
        </div>
        <p className="text-base text-muted-foreground">
          See what's happening on Stellar.
        </p>
        <SearchBox className="w-full" />
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">pre-alpha</span>
          {head ? (
            <>
              <span aria-hidden="true">{"\u00b7"}</span>
              <span className="flex items-center gap-1 whitespace-nowrap font-mono tabular-nums">
                Protocol {head.protocol_version}
                <InfoHint>
                  The network rule-set version, upgraded by validator vote.
                  Protocol upgrades ship roughly quarterly.
                </InfoHint>
              </span>
            </>
          ) : null}
          <span aria-hidden="true">{"\u00b7"}</span>
          {health.isPending ? (
            <Skeleton className="h-4 w-28" />
          ) : health.isError ? (
            <span>network unreachable</span>
          ) : (
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span
                className="size-1.5 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              network healthy
            </span>
          )}
        </div>
      </section>

      <Card className="flat">
        <CardContent className="grid gap-6 py-6 lg:grid-cols-[1fr_1fr_1.6fr] lg:divide-x lg:divide-border/60">
          <div className="flex flex-col justify-between gap-6">
            <div className="flex items-center gap-4">
              {arrival !== null ? (
                <LedgerPulse
                  key={arrival.atMs}
                  startedAtMs={arrival.atMs}
                  now={now}
                  seconds={closeSeconds ?? 5.5}
                  fromProgress={arrival.fromProgress}
                />
              ) : (
                <Skeleton className="size-11 rounded-full" />
              )}
              <Stat
                label="Latest ledger"
                value={
                  displaySeq !== undefined ? (
                    <PopNumber
                      value={Number(displaySeq).toLocaleString("en-US")}
                    />
                  ) : (
                    "..."
                  )
                }
                hint="A ledger is Stellar's block: every ~5 seconds the network agrees on a batch of transactions and seals it. The gold ring restarts on every new ledger and fills while waiting for the next one."
              />
            </div>
            <Stat
              label="Avg close time"
              value={
                closeSeconds !== undefined ? (
                  <PopNumber value={`${closeSeconds}s`} />
                ) : (
                  "..."
                )
              }
              hint="How long the network is currently taking to seal each ledger, averaged over the last few."
            />
          </div>
          <div className="flex flex-col justify-between gap-6 lg:ps-6">
            <Stat
              label="Median inclusion fee"
              value={
                fees.isSuccess
                  ? `${formatAmount(fees.data.inclusionFee.p50)} XLM`
                  : "..."
              }
              sub={
                fees.isSuccess
                  ? `= ${formatAmount(fees.data.inclusionFee.p50, 0)} stroops`
                  : undefined
              }
              hint="What half of recent transactions paid to be included, usually a tiny fraction of a cent. 1 XLM = 10,000,000 stroops."
            />
            <Stat
              label="Transactions per second"
              value={tps ? <PopNumber value={tps} /> : "..."}
              hint="Throughput over the last ~5 minutes, counting failed transactions too since they still occupy the network."
            />
          </div>
          <div className="lg:ps-6">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="flex items-center gap-1.5 text-xs font-medium">
                Transactions per ledger
                <InfoHint>
                  Each point is one ledger; the height is how many transactions
                  it carried. Hover to inspect a ledger.
                </InfoHint>
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                last ~5 min{peak !== undefined ? ` \u00b7 peak ${peak}` : ""}
              </span>
            </div>
            {ledgers.records.length >= 2 ? (
              <div className="reveal-in">
                <TxActivityChart records={ledgers.records} />
              </div>
            ) : (
              <Skeleton className="h-[112px] w-full" />
            )}
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-6">
        <Card className="flat">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <h2 className="flex items-center gap-1.5 text-lg font-semibold leading-none">
              Latest ledgers
              <InfoHint>
                Stellar has no miners and no block rewards. Validators agree on
                each ledger together through the Stellar Consensus Protocol and
                are not paid; transaction fees are burned, permanently removed
                from circulation.
              </InfoHint>
            </h2>
            <LiveDot status={ledgers.status} />
          </CardHeader>
          <CardContent>
            {ledgers.records.length === 0 ? (
              ledgers.status === "paused" ? (
                <FeedNotice height="h-[37rem]">
                  Unable to load ledgers. Retrying automatically.
                </FeedNotice>
              ) : (
                <Skeleton className="h-[37rem] w-full" />
              )
            ) : (
              <ul className="h-[37rem] overflow-hidden">
                {/* one extra card stays clipped below the fold so the list
                    bottom never shows a gap while a new card grows in */}
                {ledgers.records
                  .slice(0, LEDGER_ROWS + 1)
                  .map((ledger, index) => (
                    <li
                      key={ledger.paging_token}
                      className={cn(
                        "mb-2 h-28 last:mb-0",
                        seedTokens?.has(ledger.paging_token) === false &&
                          "ledger-card-in",
                      )}
                    >
                      <div className="flex h-full flex-col justify-between rounded-lg p-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="flex items-center gap-2">
                            <Layers
                              className="size-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <Link
                              to={appPath(`/ledger/${ledger.sequence}`)}
                              className="font-mono font-medium tabular-nums underline-offset-4 hover:underline"
                            >
                              {Number(ledger.sequence).toLocaleString("en-US")}
                            </Link>
                          </span>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {formatAgo(ledger.closed_at, now)}
                          </span>
                        </div>
                        <dl className="grid grid-cols-[3rem_1fr] gap-y-0.5 text-xs">
                          <dt className="text-muted-foreground">Txn</dt>
                          <dd className="font-mono tabular-nums">
                            {ledger.successful_transaction_count}
                            {ledger.failed_transaction_count > 0 ? (
                              <span className="text-red-600 dark:text-red-400">
                                {" "}
                                +{ledger.failed_transaction_count} failed
                              </span>
                            ) : null}
                          </dd>
                          <dt className="text-muted-foreground">Ops</dt>
                          <dd className="font-mono tabular-nums">
                            {ledger.operation_count}
                          </dd>
                          <dt className="text-muted-foreground">Burned</dt>
                          <dd className="font-mono tabular-nums">
                            {(() => {
                              const burned = subtractDecimalStrings(
                                ledger.fee_pool ?? "",
                                ledgers.records[index + 1]?.fee_pool ?? "",
                              );
                              return burned !== undefined
                                ? `${formatDecimalDisplay(burned)} XLM`
                                : "-";
                            })()}
                          </dd>
                        </dl>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="flat">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <h2 className="text-base font-semibold leading-none">
              Latest transactions
            </h2>
            <LiveDot status={txStatus} />
          </CardHeader>
          <CardContent>
            {latestTxs.length === 0 ? (
              txQuery.isError ? (
                <FeedNotice height="h-[38rem]">
                  Unable to load transactions. Retrying automatically.
                </FeedNotice>
              ) : (
                <Skeleton className="h-[38rem] w-full" />
              )
            ) : (
              <ul className="h-[38rem] overflow-hidden">
                {latestTxs.map((row, index) => (
                  <li
                    key={row.tx.paging_token}
                    className="tx-row-in grid h-[4.75rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 text-sm last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_auto] md:gap-4 lg:gap-6"
                    style={{
                      animationDelay: `calc(${index} * var(--duration-stagger))`,
                    }}
                  >
                    <span className="flex min-w-0 flex-col gap-1.5">
                      <span className="flex items-center gap-2">
                        <OpTag family={row.op?.family ?? "other"}>
                          {row.op?.label ?? "Transaction"}
                        </OpTag>
                        {row.op?.detail ? (
                          <span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:inline">
                            # {row.op.detail}
                          </span>
                        ) : null}
                        {row.tx.operation_count > 1 ? (
                          <span className="hidden text-[11px] text-muted-foreground sm:inline">
                            +{row.tx.operation_count - 1} more
                          </span>
                        ) : null}
                        {row.tx.successful ? null : (
                          <span className="text-[11px] font-medium text-red-600 dark:text-red-400">
                            failed
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {(() => {
                          const FamilyIcon =
                            FAMILY_ICONS[row.op?.family ?? "other"];
                          return (
                            <FamilyIcon
                              className="size-3.5 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                          );
                        })()}
                        <Link
                          to={appPath(`/tx/${row.tx.hash}`)}
                          className="truncate font-mono font-medium underline-offset-4 hover:underline"
                        >
                          <span className="sm:hidden">
                            {row.tx.hash.slice(0, 4)}...{row.tx.hash.slice(-4)}
                          </span>
                          <span className="hidden sm:inline">
                            {row.tx.hash.slice(0, 10)}...
                            {row.tx.hash.slice(-10)}
                          </span>
                        </Link>
                        <CopyButton
                          value={row.tx.hash}
                          label="Copy transaction hash"
                        />
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                          {formatAgo(row.tx.created_at, now)}
                        </span>
                      </span>
                    </span>
                    <span className="hidden min-w-0 flex-col gap-1 text-muted-foreground md:flex">
                      <span className="flex min-w-0 items-center gap-2">
                        {row.op?.to || row.op?.toHint ? (
                          <ArrowDown
                            className="size-3.5 shrink-0 text-muted-foreground/60"
                            aria-hidden="true"
                          />
                        ) : (
                          <span
                            className="size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <Address
                          value={row.op?.from ?? row.tx.source_account}
                          className="text-xs"
                        />
                      </span>
                      {row.op?.to ? (
                        <span className="flex min-w-0 items-center gap-2">
                          {(() => {
                            const EntityIcon = entityIconFor(row.op.to);
                            return (
                              <EntityIcon
                                className="size-3.5 shrink-0 text-muted-foreground/60"
                                aria-hidden="true"
                              />
                            );
                          })()}
                          <Address value={row.op.to} className="text-xs" />
                        </span>
                      ) : row.op?.toHint ? (
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="text-xs leading-[18px]">
                            {row.op.toHint}
                          </span>
                        </span>
                      ) : null}
                    </span>
                    <span className="flex flex-col items-end gap-1 sm:min-w-[8.5rem]">
                      {row.op?.amount ? (
                        <span className="flex items-center gap-1.5 font-mono text-sm tabular-nums">
                          {row.op.assetCode ? (
                            <AssetIcon code={row.op.assetCode} size={14} />
                          ) : null}
                          {formatDecimalDisplay(row.op.amount)}
                          {row.op.assetCode ? (
                            <span className="text-xs text-muted-foreground">
                              {row.op.assetCode}
                            </span>
                          ) : null}
                        </span>
                      ) : row.op?.assetCode ? (
                        <span className="flex items-center gap-1.5 font-mono text-sm">
                          <AssetIcon code={row.op.assetCode} size={14} />
                          <span className="text-xs text-muted-foreground">
                            {row.op.assetCode}
                          </span>
                        </span>
                      ) : (
                        <span
                          className="text-sm leading-5 text-muted-foreground/50"
                          aria-hidden="true"
                        >
                          -
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                        Fee
                        <span className="font-mono">
                          {formatXlmDisplay(row.tx.fee_charged)}
                        </span>
                        XLM
                      </span>
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
