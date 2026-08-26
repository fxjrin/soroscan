import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { ActionSummary } from "@/components/action-summary";
import { Address } from "@/components/address";
import { AssetIcon } from "@/components/asset-icon";
import {
  DataCell,
  DataRow,
  DataTable,
  NoValue,
  TableSkeleton,
  type Column,
} from "@/components/data-table";
import { OpTag } from "@/components/op-tag";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UntrustedText } from "@/components/untrusted-text";
import { EntityShell, Row, ValueBar } from "@/features/entity-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { TreeElbow, TREE_LINE, TREE_STEP } from "@/components/tree-lines";
import { InvalidEntity } from "@/features/invalid-entity";
import { enabledFlags, sortedBalances, xlmBreakdown } from "@/lib/account";
import {
  isContractInvocation,
  presentOperation,
  type PrimaryOp,
} from "@/lib/activity";
import { assetCodeOf } from "@/lib/activity";
import {
  formatAgo,
  formatDecimalDisplay,
  formatTimestamp,
  formatXlmDisplay,
  truncateMiddle,
} from "@/lib/format";
import {
  NotFoundError,
  type AccountRecord,
  type BalanceRecord,
  type OfferAsset,
  type OperationRecord,
} from "@/lib/horizon/client";
import { ACTIVE_NETWORK, appPath } from "@/lib/network";
import {
  accountOffersQuery,
  accountOperationsQuery,
  accountQuery,
  txEffectsQuery,
  txOperationsQuery,
  txQuery,
  txSorobanQuery,
} from "@/lib/queries";
import { resolveMuxed, type MuxedAddress } from "@/lib/muxed";
import { classifySearch } from "@/lib/search";
import { AuthTraceNote, CallTree } from "@/components/call-tree";
import { NetChanges } from "@/components/net-changes";
import { CallSignature } from "@/components/scval-view";
import { decodeScSymbol, decodeScVal } from "@/lib/scval";
import { groupByTransaction, type HistoryEntry } from "@/lib/history";
import { useCursorPages, type CursorPages } from "@/lib/use-cursor-pages";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const HISTORY_PAGE = 20;

const TAB_PARAM = "tab";
const DEFAULT_TAB = "details";
const SHAREABLE_TABS = [DEFAULT_TAB, "history", "offers"];

function requestedTab(params: URLSearchParams): string {
  const tab = params.get(TAB_PARAM) ?? DEFAULT_TAB;
  return SHAREABLE_TABS.includes(tab) ? tab : DEFAULT_TAB;
}

const TAB_PILL =
  "flex-none rounded-lg px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-foreground data-[state=active]:text-background dark:data-[state=active]:bg-foreground dark:data-[state=active]:text-background data-[state=active]:shadow-none";

// label and hint of every row the placeholder also renders, so the two
// cannot describe a row differently or leave the hint icon out of one
const ROW = {
  muxed: {
    label: "Account",
    hint: "This is a muxed address: one ledger account shared by many users, told apart by a subaccount id. Balances and history below belong to the account, not to the id.",
  },
  balance: {
    label: "XLM balance",
    hint: "What the account holds, what the ledger locks as reserve for its entries, and what is left to spend.",
  },
  sequence: {
    label: "Sequence",
    hint: "The number of the last transaction this account submitted; the next one must use the number after it.",
  },
  subentries: {
    label: "Subentries",
    hint: "Trustlines, offers, signers, and data entries. Each one locks 0.5 XLM of reserve.",
  },
  thresholds: {
    label: "Thresholds",
    hint: "The signature weight an operation needs, by category. A transaction is rejected unless its signatures add up to the threshold it falls under.",
  },
  domain: {
    label: "Home domain",
    hint: "A domain the account claims. Anyone can set this to anything; it means something only after checking the stellar.toml it points to.",
  },
  flags: {
    label: "Flags",
    hint: "Issuer controls set on this account: whether trustlines need approval, can be revoked, or allow clawback.",
  },
};

const BALANCE_COLUMNS: Column[] = [
  { label: "Asset" },
  { label: "Issuer" },
  { label: "Balance", numeric: true },
  { label: "Limit", numeric: true },
];

const BALANCE_MIN_WIDTH = "min-w-[44rem]";

const SIGNER_COLUMNS: Column[] = [
  { label: "Signer" },
  { label: "Type" },
  { label: "Weight", numeric: true },
];

const SIGNER_MIN_WIDTH = "min-w-[36rem]";

const OFFER_COLUMNS: Column[] = [
  { label: "Selling" },
  { label: "Buying" },
  { label: "Amount", numeric: true },
  { label: "Price", numeric: true },
  { label: "Updated", numeric: true, tight: true },
];

const OFFER_MIN_WIDTH = "min-w-[44rem]";

function OfferAssetCell({ asset }: { asset: OfferAsset }) {
  const code = assetCodeOf(asset.asset_type, asset.asset_code);
  if (code === undefined) {
    return <span className="text-muted-foreground">pool share</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-2">
        <AssetIcon code={code} size={16} />
        <UntrustedText value={code} maxLength={12} />
      </span>
      {asset.asset_issuer === undefined ? null : (
        <Address value={asset.asset_issuer} />
      )}
    </span>
  );
}

/**
 * What the account has standing on the order book: money it still holds but
 * has already promised, which neither the balances nor the history shows.
 */
function Offers({ address }: { address: string }) {
  const now = useNow();
  const pages = useCursorPages();
  const top = useRef<HTMLDivElement>(null);
  const page = useQuery(
    accountOffersQuery(ACTIVE_NETWORK, address, HISTORY_PAGE, pages.cursor),
  );
  if (page.isPending) {
    return (
      <div style={PAGED_TABLE}>
        <PagerSkeleton />
        <TableSkeleton
          columns={OFFER_COLUMNS}
          minWidth={OFFER_MIN_WIDTH}
          rows={4}
        />
      </div>
    );
  }
  if (page.isError) {
    return (
      <p className="text-muted-foreground">
        Could not load this account's offers; the data providers are
        unreachable.
      </p>
    );
  }
  const records = page.data._embedded.records;
  if (records.length === 0) {
    return (
      <p className="text-muted-foreground">
        This account has nothing standing on the order book.
      </p>
    );
  }
  return (
    <div ref={top} style={PAGED_TABLE} className="scroll-mt-14">
      <Pager
        pages={pages}
        records={records.length}
        lastToken={records[records.length - 1]?.paging_token}
        onMove={() => top.current?.scrollIntoView({ block: "start" })}
      />
      <DataTable columns={OFFER_COLUMNS} minWidth={OFFER_MIN_WIDTH}>
        {records.map((offer) => (
          <DataRow key={offer.id}>
            <DataCell>
              <OfferAssetCell asset={offer.selling} />
            </DataCell>
            <DataCell>
              <OfferAssetCell asset={offer.buying} />
            </DataCell>
            <DataCell numeric className="font-mono">
              {formatDecimalDisplay(offer.amount, 7)}
            </DataCell>
            <DataCell numeric className="font-mono">
              {formatDecimalDisplay(offer.price, 7)}
            </DataCell>
            <DataCell numeric tight className="text-muted-foreground">
              {offer.last_modified_time === undefined ? (
                <NoValue />
              ) : (
                formatAgo(offer.last_modified_time, now)
              )}
            </DataCell>
          </DataRow>
        ))}
      </DataTable>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="pb-2 pt-5 font-medium text-foreground/80">{children}</p>;
}

function BalanceRow({ balance }: { balance: BalanceRecord }) {
  const code = assetCodeOf(balance.asset_type, balance.asset_code);
  return (
    <DataRow>
      <DataCell>
        {code === undefined ? (
          <span className="text-muted-foreground">pool share</span>
        ) : (
          <span className="flex items-center gap-2">
            <AssetIcon code={code} size={16} />
            <UntrustedText value={code} maxLength={12} />
          </span>
        )}
      </DataCell>
      <DataCell>
        {balance.asset_issuer ? (
          <Address value={balance.asset_issuer} />
        ) : balance.liquidity_pool_id ? (
          <span className="font-mono text-muted-foreground">
            <UntrustedText value={balance.liquidity_pool_id} maxLength={16} />
          </span>
        ) : (
          <span className="text-muted-foreground">native</span>
        )}
      </DataCell>
      {/* Horizon reports balances as decimal strings, not stroops, so they
          go straight to the decimal formatter */}
      <DataCell numeric className="font-mono">
        {formatDecimalDisplay(balance.balance, 7)}
      </DataCell>
      <DataCell numeric className="font-mono text-muted-foreground">
        {balance.limit ? formatDecimalDisplay(balance.limit) : <NoValue />}
      </DataCell>
    </DataRow>
  );
}

function Details({
  account,
  muxed,
}: {
  account: AccountRecord;
  muxed?: MuxedAddress;
}) {
  const breakdown = xlmBreakdown(account);
  const flags = enabledFlags(account);
  const thresholds = account.thresholds;
  const entries = Object.entries(account.data ?? {});
  return (
    <>
      <dl>
        {muxed === undefined ? null : (
          <Row {...ROW.muxed}>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Address value={muxed.base} full />
              <span className="text-muted-foreground">
                subaccount {muxed.id}
              </span>
            </span>
          </Row>
        )}
        {breakdown ? (
          <Row {...ROW.balance}>
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-mono">{breakdown.total} XLM</span>
              <span className="text-muted-foreground">
                {breakdown.spendable} spendable, {breakdown.reserved} reserved
                {breakdown.liabilities === "0"
                  ? ""
                  : `, ${breakdown.liabilities} in offers`}
              </span>
            </span>
          </Row>
        ) : null}
        <Row {...ROW.sequence}>
          <span className="font-mono">
            <UntrustedText value={account.sequence} maxLength={24} />
          </span>
        </Row>
        <Row {...ROW.subentries}>{account.subentry_count}</Row>
        <Row {...ROW.thresholds}>
          <span className="font-mono">
            {thresholds.low_threshold} low {"\u00b7"} {thresholds.med_threshold}{" "}
            medium {"\u00b7"} {thresholds.high_threshold} high
          </span>
        </Row>
        {account.home_domain ? (
          <Row {...ROW.domain}>
            <UntrustedText value={account.home_domain} maxLength={64} />
          </Row>
        ) : null}
        {flags.length > 0 ? <Row {...ROW.flags}>{flags.join(", ")}</Row> : null}
      </dl>

      <SectionLabel>Balances</SectionLabel>
      <DataTable columns={BALANCE_COLUMNS} minWidth={BALANCE_MIN_WIDTH}>
        {sortedBalances(account).map((balance, index) => (
          <BalanceRow
            key={`${balance.asset_code ?? balance.asset_type}-${index}`}
            balance={balance}
          />
        ))}
      </DataTable>

      <SectionLabel>Signers</SectionLabel>
      <DataTable columns={SIGNER_COLUMNS} minWidth={SIGNER_MIN_WIDTH}>
        {account.signers.map((signer) => (
          <DataRow key={signer.key}>
            <DataCell>
              <Address value={signer.key} />
            </DataCell>
            <DataCell className="text-muted-foreground">
              <UntrustedText
                value={signer.type.replace(/_/g, " ")}
                maxLength={32}
              />
            </DataCell>
            <DataCell numeric>{signer.weight}</DataCell>
          </DataRow>
        ))}
      </DataTable>

      {entries.length > 0 ? (
        <>
          <SectionLabel>Data entries</SectionLabel>
          <DataTable
            columns={[{ label: "Name" }, { label: "Value (base64)" }]}
            minWidth="min-w-[36rem]"
          >
            {entries.map(([name, value]) => (
              <DataRow key={name}>
                <DataCell className="font-mono">
                  <UntrustedText value={name} maxLength={64} />
                </DataCell>
                <DataCell className="font-mono text-muted-foreground">
                  <UntrustedText value={value} maxLength={96} />
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        </>
      ) : null}
    </>
  );
}

const PAGER_BUTTON =
  "flex h-9 items-center justify-center rounded-lg border px-3 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40";

/**
 * The page controls sit above the rows and stay there while the reader
 * scrolls, so moving to the next page never means scrolling back up. Its
 * height is fixed because the table header parks directly underneath it.
 */
function Pager({
  pages,
  records,
  lastToken,
  onMove,
}: {
  pages: CursorPages;
  records: number;
  lastToken?: string;
  /** a new page starts at its own beginning, not where the last one ended */
  onMove: () => void;
}) {
  // Horizon does not say how much is left, so a full page is the only hint
  // that another one exists
  const hasMore = records === HISTORY_PAGE && lastToken !== undefined;
  return (
    // the table bleeds three units past this container on both sides, so the
    // bar bleeds with it or rows show through at the edges while scrolling
    <div className="sticky top-14 z-20 -mx-3 flex h-[3.25rem] items-center gap-2 bg-background px-3">
      <button
        type="button"
        onClick={() => {
          pages.reset();
          onMove();
        }}
        disabled={pages.atStart}
        className={PAGER_BUTTON}
      >
        First
      </button>
      <button
        type="button"
        onClick={() => {
          pages.back();
          onMove();
        }}
        disabled={pages.atStart}
        aria-label="Previous page"
        className={cn(PAGER_BUTTON, "px-2.5")}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>
      {/* the current page is a label, not a control: there is no page list
          to jump around in, because Horizon pages by cursor */}
      <span
        aria-label={`Page ${pages.depth + 1}`}
        className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-muted px-2.5 font-medium"
      >
        {pages.depth + 1}
      </span>
      <button
        type="button"
        onClick={() => {
          if (lastToken === undefined) {
            return;
          }
          pages.next(lastToken);
          onMove();
        }}
        disabled={!hasMore}
        aria-label="Next page"
        className={cn(PAGER_BUTTON, "px-2.5")}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

// the header comes to rest under the pager: the site header plus the row
// of controls above it
const PAGED_TABLE = { "--table-sticky-top": "6.75rem" } as CSSProperties;

const HISTORY_COLUMNS: Column[] = [
  { label: "Type", tight: true },
  { label: "Transaction" },
  { label: "Fee", numeric: true, tight: true },
  { label: "Age", numeric: true, tight: true },
];

const HISTORY_MIN_WIDTH = "min-w-[44rem]";

/**
 * What one transaction did to this account, closed. A contract call reads as
 * the call itself, the way the call tree opens on the transaction page; a
 * classic transaction reads as a sentence. The row opens into the full
 * detail, which is the only part that needs a request of its own, so it is
 * made when the reader asks for it and not before.
 */
function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const record = entry.operations[0];
  const op = presentOperation(record);
  const invokes = isContractInvocation(record);
  const created = record.created_at;
  const fee = record.transaction?.fee_charged;
  // pointing at a row is the reader saying they might open it, and the two
  // cheap requests behind it are worth making then rather than on the click.
  // The trace is not among them: for an old transaction it pulls a whole
  // ledger from the archive, which is too much to spend on a maybe
  const warm = () => {
    void client.prefetchQuery(txQuery(ACTIVE_NETWORK, entry.hash));
    void client.prefetchQuery(txEffectsQuery(ACTIVE_NETWORK, entry.hash));
    if (!invokes) {
      void client.prefetchQuery(txOperationsQuery(ACTIVE_NETWORK, entry.hash));
    }
  };

  return (
    <DataRow>
      {/* what kind of thing this was, in a column of its own so the tags
          line up and the sentence beside them still starts where the tree
          below it hangs from */}
      <DataCell tight className="align-top" onPointerEnter={warm}>
        <OpTag family={op.family}>{op.label}</OpTag>
      </DataCell>
      <DataCell className="align-top" onPointerEnter={warm}>
        <details
          className="group"
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-start gap-2">
            <ChevronRight
              className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
            {invokes ? (
              <CallLine record={record} op={op} />
            ) : (
              <ActionSummary op={op} opCount={entry.operations.length} />
            )}
          </summary>
          {/* the disclosure marker holds a column of its own in the summary
              above, so the body starts under the label rather than under the
              marker: one chevron plus the gap after it */}
          <div className="ps-[1.375rem]">
            {open ? (
              <>
                <HistoryDetail
                  hash={entry.hash}
                  invokes={invokes}
                  invoker={record.source_account}
                />
                {/* the row answers what happened; everything else about the
                    transaction, resources and fee split included, lives on
                    its own page, and this is the way there */}
                <Link
                  to={appPath(`/tx/${entry.hash}`)}
                  className="mt-3 inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  Open transaction
                  <span className="font-mono text-link">
                    {truncateMiddle(entry.hash, 8)}
                  </span>
                </Link>
              </>
            ) : null}
          </div>
        </details>
      </DataCell>
      <DataCell numeric tight className="align-top font-mono">
        {/* the fee is charged once for the transaction, not per operation,
            and rides along with it in the same request */}
        {fee === undefined ? (
          <NoValue />
        ) : (
          <>
            {formatXlmDisplay(fee)}
            <span className="text-muted-foreground"> XLM</span>
          </>
        )}
      </DataCell>
      <DataCell numeric tight className="align-top">
        {created === undefined ? (
          <NoValue />
        ) : (
          // how long ago answers the glance; the timestamp answers the
          // question that follows it, and both belong to the same column
          <span className="flex flex-col items-end">
            <Link
              to={appPath(`/tx/${entry.hash}`)}
              className="text-link transition-colors hover:text-link-hover"
            >
              {formatAgo(created, now)}
            </Link>
            <span className="text-muted-foreground">
              {formatTimestamp(created)}
            </span>
          </span>
        )}
      </DataCell>
    </DataRow>
  );
}

/**
 * A contract call the way the call tree writes it: who called, what they
 * called it on, and the function with its decoded arguments. The value it
 * returned lives in the transaction meta, so it appears once the row is
 * open and the trace has been fetched.
 */
function CallLine({ record, op }: { record: OperationRecord; op: PrimaryOp }) {
  const params = record.parameters ?? [];
  const name = decodeScSymbol(params[1]?.value ?? "");
  if (name === undefined) {
    return <ActionSummary op={op} />;
  }
  const args = params.slice(2).map((param) => decodeScVal(param.value));
  return (
    <span className="block">
      <Address value={record.source_account} />
      <span className="mx-2 text-muted-foreground">call</span>
      {op.to ? <Address value={op.to} /> : null}
      <span className={op.to ? "ms-1.5" : undefined}>
        <CallSignature name={name} args={args} />
      </span>
    </span>
  );
}

function HistoryDetail({
  hash,
  invokes,
  invoker,
}: {
  hash: string;
  invokes: boolean;
  invoker: string;
}) {
  // the meta ages out of RPC retention in about a week, and after that the
  // only trace left is the one rebuilt from the envelope's authorization
  // entries. That is what the transaction page does, so this asks for the
  // envelope too rather than showing less for the same transaction
  const detail = useQuery({
    ...txQuery(ACTIVE_NETWORK, hash),
    enabled: invokes,
  });
  const soroban = useQuery({
    ...txSorobanQuery(ACTIVE_NETWORK, hash, {
      envelopeXdr: detail.data?.envelope_xdr,
      ledger: detail.data?.ledger,
    }),
    // the envelope improves the answer rather than gating it: if it cannot
    // be fetched, the meta alone is still worth asking for
    enabled: invokes && !detail.isPending,
  });
  const operations = useQuery({
    ...txOperationsQuery(ACTIVE_NETWORK, hash),
    enabled: !invokes,
  });
  const pending = invokes
    ? detail.isPending || soroban.isPending
    : operations.isPending;
  if (pending) {
    return (
      <div className="py-2">
        <ValueBar className="w-full max-w-[24rem]" />
      </div>
    );
  }
  if (invokes) {
    const trace = soroban.data?.trace ?? null;
    return (
      <div className="pt-1">
        {trace === null || trace.calls.length === 0 ? (
          <p className="pb-2 text-muted-foreground">
            No call trace is available for this transaction.
          </p>
        ) : (
          <>
            {/* a tree rebuilt from authorization data is not the execution,
                and saying so belongs wherever the tree is shown */}
            {trace.source === "auth" ? <AuthTraceNote /> : null}
            <CallTree calls={trace.calls} invoker={invoker} continuation />
          </>
        )}
        <BalanceMoves hash={hash} />
      </div>
    );
  }
  if (operations.isError || operations.data === undefined) {
    return (
      <p className="py-2 text-muted-foreground">
        Could not load this transaction's operations.
      </p>
    );
  }
  const records = operations.data._embedded.records;
  return (
    <>
      {/* the same lines the call tree draws, so a transaction reads the way
          a contract call does: the row above is the parent, these are its
          steps */}
      <ol>
        {records.map((record, index) => {
          const step = presentOperation(record);
          return (
            <li
              key={record.id}
              className="relative py-2"
              style={{ paddingInlineStart: TREE_STEP }}
            >
              <TreeElbow
                start={TREE_LINE}
                last={index === records.length - 1}
              />
              <span className="flex flex-wrap items-center gap-2">
                <OpTag family={step.family}>{step.label}</OpTag>
                <ActionSummary op={step} />
              </span>
            </li>
          );
        })}
      </ol>
      <BalanceMoves hash={hash} />
    </>
  );
}

/**
 * What the transaction moved, from the effects Horizon keeps for good. It is
 * the part of a transaction that survives the execution meta ageing out, so
 * an old contract call still says what changed hands.
 */
function BalanceMoves({ hash }: { hash: string }) {
  const effects = useQuery(txEffectsQuery(ACTIVE_NETWORK, hash));
  if (!effects.isSuccess) {
    return null;
  }
  return (
    <div className="pt-2">
      <NetChanges effects={effects.data._embedded.records} />
    </div>
  );
}

function History({ address }: { address: string }) {
  const pages = useCursorPages();
  const top = useRef<HTMLDivElement>(null);
  const page = useQuery(
    accountOperationsQuery(ACTIVE_NETWORK, address, HISTORY_PAGE, pages.cursor),
  );
  const client = useQueryClient();
  const records = page.data?._embedded.records;
  const entries =
    records === undefined ? undefined : groupByTransaction(records);
  const nextCursor =
    records?.length === HISTORY_PAGE
      ? entries?.[entries.length - 1]?.lastToken
      : undefined;

  // one page ahead is one request that is almost always wanted next, so it
  // is fetched while the reader is still on this one
  useEffect(() => {
    if (nextCursor === undefined) {
      return;
    }
    void client.prefetchQuery(
      accountOperationsQuery(ACTIVE_NETWORK, address, HISTORY_PAGE, nextCursor),
    );
  }, [client, address, nextCursor]);

  if (page.isPending) {
    return (
      <div style={PAGED_TABLE}>
        <PagerSkeleton />
        <TableSkeleton
          columns={HISTORY_COLUMNS}
          minWidth={HISTORY_MIN_WIDTH}
          rows={6}
        />
      </div>
    );
  }
  if (page.isError) {
    return (
      <p className="text-muted-foreground">
        Could not load this account's history; the data providers are
        unreachable.
      </p>
    );
  }
  if (records === undefined || entries === undefined || entries.length === 0) {
    return (
      <p className="text-muted-foreground">
        No activity on this page of the account's history.
      </p>
    );
  }
  return (
    // scroll-mt clears the site header, so landing here does not put the
    // top of the table underneath it
    <div ref={top} style={PAGED_TABLE} className="scroll-mt-14">
      <Pager
        pages={pages}
        records={records.length}
        lastToken={entries[entries.length - 1]?.lastToken}
        onMove={() => top.current?.scrollIntoView({ block: "start" })}
      />
      <DataTable columns={HISTORY_COLUMNS} minWidth={HISTORY_MIN_WIDTH}>
        {entries.map((entry) => (
          <HistoryRow key={entry.hash + entry.lastToken} entry={entry} />
        ))}
      </DataTable>
    </div>
  );
}

const TAB_PLACEHOLDER_WIDTHS = ["w-12", "w-16", "w-14"];

// the pager holds the same band while it loads, so the table header below
// it does not move once the rows arrive
function PagerSkeleton() {
  return (
    <div className="flex h-[3.25rem] items-center gap-2" aria-hidden="true">
      <Skeleton className="h-9 w-16 rounded-lg" />
      <Skeleton className="h-9 w-10 rounded-lg" />
      <Skeleton className="h-9 w-9 rounded-lg" />
      <Skeleton className="h-9 w-10 rounded-lg" />
    </div>
  );
}

function DetailsSkeleton() {
  return (
    <>
      <dl>
        <Row {...ROW.balance}>
          <ValueBar className="w-full max-w-[26rem]" />
        </Row>
        <Row {...ROW.sequence}>
          <ValueBar className="w-44" />
        </Row>
        <Row {...ROW.subentries}>
          <ValueBar className="w-8" />
        </Row>
        <Row {...ROW.thresholds}>
          <ValueBar className="w-56" />
        </Row>
      </dl>
      <SectionLabel>Balances</SectionLabel>
      <TableSkeleton
        columns={BALANCE_COLUMNS}
        minWidth={BALANCE_MIN_WIDTH}
        rows={3}
      />
      <SectionLabel>Signers</SectionLabel>
      <TableSkeleton
        columns={SIGNER_COLUMNS}
        minWidth={SIGNER_MIN_WIDTH}
        rows={1}
      />
    </>
  );
}

function AccountSkeleton({ tab }: { tab: string }) {
  return (
    <Tabs value={tab}>
      <TabsList className="h-auto gap-2 bg-transparent p-0">
        {TAB_PLACEHOLDER_WIDTHS.map((width) => (
          <TabsTrigger key={width} value={width} className={TAB_PILL} disabled>
            <ValueBar className={width} />
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={tab} className="pt-5">
        {tab === "offers" ? (
          <div style={PAGED_TABLE}>
            <PagerSkeleton />
            <TableSkeleton
              columns={OFFER_COLUMNS}
              minWidth={OFFER_MIN_WIDTH}
              rows={4}
            />
          </div>
        ) : tab === "history" ? (
          <div style={PAGED_TABLE}>
            <PagerSkeleton />
            <TableSkeleton
              columns={HISTORY_COLUMNS}
              minWidth={HISTORY_MIN_WIDTH}
              rows={6}
            />
          </div>
        ) : (
          <DetailsSkeleton />
        )}
      </TabsContent>
    </Tabs>
  );
}

export function AccountPage() {
  const { address = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const target = classifySearch(address);
  const valid = target.type === "account";

  // an M address is one real account plus a subaccount id. Everything on
  // chain belongs to the account, and Horizon rejects the M form outright,
  // so the id is set aside and the lookup uses the account
  const muxed = resolveMuxed(target.value);
  const ledgerAddress = muxed?.base ?? target.value;

  const account = useQuery({
    ...accountQuery(ACTIVE_NETWORK, ledgerAddress),
    enabled: valid,
  });

  if (!valid) {
    return <InvalidEntity expected="account address" value={address} />;
  }

  const wanted = requestedTab(params);

  let body: ReactNode;
  if (account.isPending) {
    body = <AccountSkeleton tab={wanted} />;
  } else if (account.isSuccess) {
    body = (
      <Tabs
        value={wanted}
        onValueChange={(tab) => {
          const next = new URLSearchParams(params);
          if (tab === DEFAULT_TAB) {
            next.delete(TAB_PARAM); // the overview is the bare url
          } else {
            next.set(TAB_PARAM, tab);
          }
          setParams(next, { replace: true });
        }}
      >
        <TabsList className="h-auto gap-2 bg-transparent p-0">
          <TabsTrigger value="details" className={TAB_PILL}>
            Details
          </TabsTrigger>
          <TabsTrigger value="history" className={TAB_PILL}>
            History
          </TabsTrigger>
          <TabsTrigger value="offers" className={TAB_PILL}>
            Offers
          </TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="pt-5">
          <Details account={account.data} muxed={muxed} />
        </TabsContent>
        <TabsContent value="history" className="pt-5">
          <History address={ledgerAddress} />
        </TabsContent>
        <TabsContent value="offers" className="pt-5">
          <Offers address={ledgerAddress} />
        </TabsContent>
      </Tabs>
    );
  } else if (account.error instanceof NotFoundError) {
    body = (
      <p className="text-muted-foreground">
        This account does not exist on the ledger. An address only becomes an
        account once it has been funded.
      </p>
    );
  } else {
    body = (
      <p className="text-muted-foreground">
        Could not load this account; the data providers are unreachable.
      </p>
    );
  }

  return (
    <EntityShell
      title="Account"
      identifier={<Address value={target.value} full />}
    >
      {body}
    </EntityShell>
  );
}
