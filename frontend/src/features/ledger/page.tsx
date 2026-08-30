import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ChevronLeft, ChevronRight, CircleX } from "lucide-react";
import { Address } from "@/components/address";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/data-table";
import { InfoHint } from "@/components/info-hint";
import { EntityShell, Row, ValueBar } from "@/features/entity-shell";
import { HistoryRow, Pager } from "@/features/history-table";
import {
  HISTORY_COLUMNS,
  HISTORY_MIN_WIDTH,
  PAGED_TABLE,
} from "@/features/history-table-layout";
import { InvalidEntity } from "@/features/invalid-entity";
import { OpTag } from "@/components/op-tag";
import { presentOperation, type OpFamily } from "@/lib/activity";
import {
  formatAgo,
  formatDecimalDisplay,
  formatTimestamp,
  subtractDecimalStrings,
} from "@/lib/format";
import { NotFoundError, type LedgerRecord } from "@/lib/horizon/client";
import { indexerAvailable } from "@/lib/indexer/client";
import { ACTIVE_NETWORK, appPath } from "@/lib/network";
import {
  healthQuery,
  ledgerOperationsQuery,
  ledgerQuery,
  ledgerSorobanQuery,
} from "@/lib/queries";
import { classifySearch } from "@/lib/search";
import { useNow } from "@/lib/use-now";

const MAX_LEDGER_SEQUENCE = 4294967295; // u32, per the ledger header
const TX_PAGE_SIZE = 25;
const FAILED_FILTER = "__failed"; // never a real type label, so it cannot collide
// entrance stagger stops after the first screenful, so a page of two
// hundred rows does not spend seconds trickling in
const MAX_STAGGER_STEPS = 12;

function staggerDelay(index: number) {
  return {
    animationDelay: `calc(${Math.min(index, MAX_STAGGER_STEPS)} * var(--duration-stagger))`,
  };
}

function LedgerSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="rounded-xl border border-border/60 p-4">
          <ValueBar className="w-16" />
          <div className="mt-3">
            <ValueBar className="w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  hint,
  index,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hint?: ReactNode;
  index: number;
}) {
  return (
    <div className="tx-row-in flex flex-col gap-1" style={staggerDelay(index)}>
      <div className="font-mono text-xl font-bold leading-none tabular-nums">
        {value}
      </div>
      {sub === undefined ? null : (
        <div className="truncate font-mono text-muted-foreground">{sub}</div>
      )}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {label}
        {hint === undefined ? null : <InfoHint>{hint}</InfoHint>}
      </div>
    </div>
  );
}

const FAMILY_CELL: Record<OpFamily, string> = {
  contract: "bg-sky-500/80",
  transfer: "bg-emerald-500/70",
  dex: "bg-violet-500/70",
  config: "bg-zinc-500/50",
  other: "bg-zinc-500/50",
};
const MAP_CELL_LIMIT = 600;

type PresentedRow = {
  entry: { hash: string };
  op: { label: string; family: OpFamily };
  failed: boolean;
};

/**
 * The ledger as mempool.space draws a block: one square per transaction,
 * laid out in the order the ledger applied them. Color carries the type,
 * red alone marks failure so it pops out of any crowd, and the type chips
 * double as this map's legend and filter: a pick dims everything else.
 */
function LedgerMap({
  rows,
  filter,
  truncated,
}: {
  rows: PresentedRow[];
  filter: string;
  truncated: boolean;
}) {
  if (rows.length < 2) {
    return null;
  }
  const shown = rows.slice(0, MAP_CELL_LIMIT);
  const matches = (row: PresentedRow) =>
    filter === "" ||
    (filter === FAILED_FILTER ? row.failed : row.op.label === filter);
  return (
    <div className="reveal-in flex flex-col gap-2">
      <div className="flex flex-wrap gap-[3px]">
        {shown.map((row) => (
          <Link
            key={row.entry.hash}
            to={appPath(`/tx/${row.entry.hash}`)}
            aria-label={`${row.op.label}${row.failed ? " failed" : ""} transaction ${row.entry.hash}`}
            title={
              row.op.label +
              (row.failed ? " (failed) " : " ") +
              row.entry.hash.slice(0, 8)
            }
            className={
              "size-2.5 rounded-[2px] transition-opacity hover:ring-1 hover:ring-ring " +
              (row.failed ? "bg-red-500/80" : FAMILY_CELL[row.op.family]) +
              (matches(row) ? "" : " opacity-20")
            }
          />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Each square is one transaction, in the order the ledger applied them
        {truncated || rows.length > MAP_CELL_LIMIT
          ? "; the largest ledgers show their first squares"
          : ""}
        .
      </p>
    </div>
  );
}

function closeDuration(ledger: LedgerRecord, prev: LedgerRecord | undefined) {
  if (prev === undefined) {
    return undefined;
  }
  const seconds =
    (Date.parse(ledger.closed_at) - Date.parse(prev.closed_at)) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60) {
    return undefined;
  }
  return seconds.toFixed(1);
}

function SequenceNav({
  sequence,
  latest,
}: {
  sequence: number;
  latest: number | undefined;
}) {
  const atTip = latest !== undefined && sequence >= latest;
  const arrow =
    "flex size-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  const disabled = " pointer-events-none opacity-40";
  return (
    <span className="flex items-center gap-2">
      <Link
        to={appPath(`/ledger/${sequence - 1}`)}
        aria-label="Previous ledger"
        className={arrow + (sequence <= 1 ? disabled : "")}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Link>
      <span className="font-mono">{sequence.toLocaleString("en-US")}</span>
      <Link
        to={appPath(`/ledger/${sequence + 1}`)}
        aria-label="Next ledger"
        className={arrow + (atTip ? disabled : "")}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Link>
    </span>
  );
}

/**
 * The types this page of the ledger holds, as counted chips that filter
 * the list: the summary is the control. A count covers the loaded page,
 * which for most ledgers is the whole ledger.
 */
function TypeChips({
  counts,
  selected,
  onSelect,
  failedCount,
}: {
  counts: Map<
    string,
    { family: Parameters<typeof OpTag>[0]["family"]; count: number }
  >;
  selected: string;
  onSelect: (label: string) => void;
  failedCount: number;
}) {
  if (counts.size < 2 && failedCount === 0) {
    return null;
  }
  return (
    <div className="reveal-in flex flex-wrap items-center gap-2">
      {[...counts.entries()].map(([label, entry]) => {
        const active = selected === label;
        return (
          <button
            key={label}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? "" : label)}
            className={
              "rounded-sm transition-opacity" +
              (active
                ? " ring-2 ring-ring"
                : selected !== ""
                  ? " opacity-50 hover:opacity-100"
                  : " hover:opacity-80")
            }
          >
            <OpTag family={entry.family}>
              {label}
              <span className="font-mono text-xs opacity-80">
                {entry.count}
              </span>
            </OpTag>
          </button>
        );
      })}
      {failedCount === 0 ? null : (
        <button
          type="button"
          aria-pressed={selected === FAILED_FILTER}
          onClick={() =>
            onSelect(selected === FAILED_FILTER ? "" : FAILED_FILTER)
          }
          className={
            "rounded-sm transition-opacity" +
            (selected === FAILED_FILTER
              ? " ring-2 ring-ring"
              : selected !== ""
                ? " opacity-50 hover:opacity-100"
                : " hover:opacity-80")
          }
        >
          <span className="inline-flex h-6 items-center gap-1.5 rounded-sm bg-red-500/10 ps-1.5 pe-[7px] font-medium text-red-600 dark:text-red-400">
            <CircleX className="size-4 shrink-0" aria-hidden="true" />
            failed
            <span className="font-mono text-xs opacity-80">{failedCount}</span>
          </span>
        </button>
      )}
    </div>
  );
}

function LedgerBody({ ledger }: { ledger: LedgerRecord }) {
  const now = useNow();
  const top = useRef<HTMLDivElement>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const sequence = ledger.sequence;
  const prev = useQuery({
    ...ledgerQuery(ACTIVE_NETWORK, String(sequence - 1)),
    enabled: sequence > 1,
  });
  const soroban = useQuery({
    ...ledgerSorobanQuery(ACTIVE_NETWORK, sequence),
    enabled: indexerAvailable(ACTIVE_NETWORK),
  });
  const activity = useQuery(
    ledgerOperationsQuery(ACTIVE_NETWORK, String(sequence)),
  );

  const duration = closeDuration(ledger, prev.data);
  const fees = subtractDecimalStrings(
    ledger.fee_pool ?? "",
    prev.data?.fee_pool ?? "",
  );
  const submitted = ledger.tx_set_operation_count;
  const stats = soroban.data;

  const entries = activity.data?.entries;
  const presented = useMemo(() => {
    if (entries === undefined) {
      return [];
    }
    return entries.map((entry) => {
      const first = entry.operations[0];
      return {
        entry,
        op: presentOperation(first),
        failed:
          first.transaction_successful === false ||
          first.transaction?.successful === false,
      };
    });
  }, [entries]);
  const typeCounts = useMemo(() => {
    const counts = new Map<
      string,
      { family: (typeof presented)[number]["op"]["family"]; count: number }
    >();
    for (const { op } of presented) {
      const current = counts.get(op.label);
      if (current === undefined) {
        counts.set(op.label, { family: op.family, count: 1 });
      } else {
        current.count += 1;
      }
    }
    return new Map(
      [...counts.entries()].sort((a, b) => b[1].count - a[1].count),
    );
  }, [presented]);
  const failedCount = presented.filter(({ failed }) => failed).length;
  const filteredEntries =
    typeFilter === ""
      ? presented
      : typeFilter === FAILED_FILTER
        ? presented.filter(({ failed }) => failed)
        : presented.filter(({ op }) => op.label === typeFilter);
  const pageCount = Math.max(
    1,
    Math.ceil(filteredEntries.length / TX_PAGE_SIZE),
  );
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const shownEntries = filteredEntries.slice(
    currentPage * TX_PAGE_SIZE,
    (currentPage + 1) * TX_PAGE_SIZE,
  );
  // the whole list is in memory, so the pager is a plain index walk
  const pages = {
    cursor: currentPage === 0 ? undefined : String(currentPage),
    depth: currentPage,
    atStart: currentPage === 0,
    next: () => setPageIndex((index) => index + 1),
    back: () => setPageIndex((index) => Math.max(0, index - 1)),
    reset: () => setPageIndex(0),
  };
  const selectType = (label: string) => {
    setTypeFilter(label);
    setPageIndex(0);
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="reveal-in flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span>
          {formatAgo(ledger.closed_at, now)}{" "}
          <span>{formatTimestamp(ledger.closed_at)}</span>
        </span>
        {duration === undefined ? null : (
          <span>
            closed in <span className="font-mono">{duration}s</span>
          </span>
        )}
        <span>Protocol {ledger.protocol_version}</span>
      </div>

      <Card className="flat">
        <CardContent className="flex flex-col gap-6 py-6">
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4 lg:divide-x lg:divide-border/60">
            <Stat
              index={0}
              label="Transactions"
              hint="Everything this ledger applied. A failed transaction changes nothing but still pays its fee, so it stays on the record."
              value={
                <>
                  {ledger.successful_transaction_count.toLocaleString("en-US")}
                  {ledger.failed_transaction_count > 0 ? (
                    <span className="text-red-600 dark:text-red-400">
                      {" "}
                      +{ledger.failed_transaction_count.toLocaleString("en-US")}
                    </span>
                  ) : null}
                </>
              }
              sub={
                ledger.failed_transaction_count > 0
                  ? "succeeded + failed"
                  : "all succeeded"
              }
            />
            <Stat
              index={1}
              label="Operations"
              hint="Operations the ledger applied, against how many its transaction set carried in. The gap is work that failed or was surged out."
              value={ledger.operation_count.toLocaleString("en-US")}
              sub={
                submitted !== undefined && submitted !== ledger.operation_count
                  ? `of ${submitted.toLocaleString("en-US")} submitted`
                  : "applied"
              }
            />
            <Stat
              index={2}
              label="Contract calls"
              hint="Transactions that invoked a smart contract directly in this ledger, counted by the soroscan indexer."
              value={
                stats?.indexed === true
                  ? stats.invocations.toLocaleString("en-US")
                  : "-"
              }
              sub={
                !indexerAvailable(ACTIVE_NETWORK)
                  ? "Mainnet only"
                  : stats?.indexed === true
                    ? `${stats.contracts.toLocaleString("en-US")} ${
                        stats.contracts === 1 ? "contract" : "contracts"
                      }`
                    : "not indexed yet"
              }
            />
            <Stat
              index={3}
              label="Fees"
              hint="XLM the ledger collected into the network fee pool, from every transaction it applied."
              value={fees === undefined ? "-" : formatDecimalDisplay(fees)}
              sub="XLM collected"
            />
          </div>
        </CardContent>
      </Card>

      <section ref={top} className="flex scroll-mt-14 flex-col gap-3">
        <h2 className="text-lg font-semibold">Transactions</h2>
        <TypeChips
          counts={typeCounts}
          selected={typeFilter}
          onSelect={selectType}
          failedCount={failedCount}
        />
        <LedgerMap
          rows={presented}
          filter={typeFilter}
          truncated={activity.data?.truncated === true}
        />
        {activity.isPending ? (
          <ValueBar className="w-full max-w-[28rem]" />
        ) : activity.isError ? (
          <p className="text-muted-foreground">
            Could not load this ledger's transactions; the data providers are
            unreachable.
          </p>
        ) : activity.data.entries.length === 0 ? (
          <p className="text-muted-foreground">
            This ledger closed without applying any transactions.
          </p>
        ) : (
          <div style={PAGED_TABLE}>
            <Pager
              pages={pages}
              records={shownEntries.length}
              pageSize={TX_PAGE_SIZE}
              lastToken={currentPage + 1 < pageCount ? "next" : undefined}
              more={currentPage + 1 < pageCount}
              onMove={() => top.current?.scrollIntoView({ block: "start" })}
            />
            <div className="rows-in">
              {shownEntries.length === 0 ? (
                <p className="py-4 text-muted-foreground">
                  No {typeFilter === FAILED_FILTER ? "failed" : typeFilter}{" "}
                  transactions in this ledger.
                </p>
              ) : (
                <DataTable
                  columns={HISTORY_COLUMNS}
                  minWidth={HISTORY_MIN_WIDTH}
                >
                  {shownEntries.map(({ entry }) => (
                    <HistoryRow key={entry.hash} entry={entry} />
                  ))}
                </DataTable>
              )}
            </div>
          </div>
        )}
      </section>

      <details className="group">
        <summary className="cursor-pointer list-none text-muted-foreground transition-colors hover:text-foreground">
          <span className="group-open:hidden">Show ledger internals</span>
          <span className="hidden group-open:inline">
            Hide ledger internals
          </span>
        </summary>
        <dl className="mt-2">
          <Row label="Hash">
            <Address value={ledger.hash} />
          </Row>
          {ledger.prev_hash === undefined ? null : (
            <Row label="Previous hash">
              <Link
                to={appPath(`/ledger/${sequence - 1}`)}
                className="font-mono text-link transition-colors hover:text-link-hover"
              >
                {ledger.prev_hash.slice(0, 4)}...{ledger.prev_hash.slice(-4)}
              </Link>
            </Row>
          )}
          {ledger.total_coins === undefined ? null : (
            <Row label="Total XLM">
              {formatDecimalDisplay(ledger.total_coins)} XLM
            </Row>
          )}
          {ledger.fee_pool === undefined ? null : (
            <Row label="Fee pool">
              {formatDecimalDisplay(ledger.fee_pool)} XLM
            </Row>
          )}
          {ledger.base_fee_in_stroops === undefined ? null : (
            <Row label="Base fee">{ledger.base_fee_in_stroops} stroops</Row>
          )}
          {ledger.base_reserve_in_stroops === undefined ? null : (
            <Row label="Base reserve">
              {formatDecimalDisplay(
                String(ledger.base_reserve_in_stroops / 10_000_000),
              )}{" "}
              XLM
            </Row>
          )}
          {ledger.max_tx_set_size === undefined ? null : (
            <Row label="Max tx set size">{ledger.max_tx_set_size}</Row>
          )}
        </dl>
      </details>
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
    enabled: valid,
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
    body = <LedgerBody key={ledger.data.sequence} ledger={ledger.data} />;
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
      identifier={<SequenceNav sequence={seq} latest={latest} />}
    >
      {body}
    </EntityShell>
  );
}
