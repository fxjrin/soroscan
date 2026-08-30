import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { ActionSummary } from "@/components/action-summary";
import { Address } from "@/components/address";
import { DataCell, DataRow, NoValue } from "@/components/data-table";
import { OpTag, StatusChip } from "@/components/op-tag";
import { Skeleton } from "@/components/ui/skeleton";
import { ValueBar } from "@/features/entity-shell";
import { AuthTraceNote, CallTree } from "@/components/call-tree";
import { NetChangeLine } from "@/components/net-changes";
import { StepGroup } from "@/components/step-group";
import { StateChangeKind } from "@/components/trace-changes";
import { CallSignature, ScValView } from "@/components/scval-view";
import { TreeElbow, TREE_LINE, TREE_STEP } from "@/components/tree-lines";
import { netBalanceChanges } from "@/lib/balance-changes";
import {
  isContractInvocation,
  presentOperation,
  type PrimaryOp,
} from "@/lib/activity";
import {
  formatAgo,
  formatTimestamp,
  formatXlmDisplay,
  truncateMiddle,
} from "@/lib/format";
import type { OperationRecord } from "@/lib/horizon/client";
import type { HistoryEntry } from "@/lib/history";
import { ACTIVE_NETWORK, appPath } from "@/lib/network";
import {
  txEffectsQuery,
  txOperationsQuery,
  txQuery,
  txSorobanQuery,
} from "@/lib/queries";
import { decodeScSymbol, decodeScVal } from "@/lib/scval";
import type { TraceStateChange, TraceTtl } from "@/lib/tx-trace";
import type { CursorPages } from "@/lib/use-cursor-pages";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const PAGER_BUTTON =
  "flex h-9 items-center justify-center rounded-lg border px-3 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40";

/**
 * The page controls sit above the rows and stay there while the reader
 * scrolls, so moving to the next page never means scrolling back up. Its
 * height is fixed because the table header parks directly underneath it.
 */
export function Pager({
  pages,
  records,
  pageSize,
  lastToken,
  more,
  onMove,
  trailing,
}: {
  pages: CursorPages;
  records: number;
  pageSize: number;
  lastToken?: string;
  /** providers that state whether more exists pass it; the rest are guessed */
  more?: boolean;
  /** a new page starts at its own beginning, not where the last one ended */
  onMove: () => void;
  /** extra controls rendered at the far end of the bar */
  trailing?: React.ReactNode;
}) {
  // without an explicit answer, a full page is the only hint that another
  // one exists: the provider does not say how much is left
  const hasMore = more ?? (records === pageSize && lastToken !== undefined);
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
          to jump around in, because the provider pages by cursor */}
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
      {trailing !== undefined && <div className="ms-auto">{trailing}</div>}
    </div>
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

/**
 * A storage write or a ttl extension, read as a sentence like the rest of
 * this row's detail: no columns of its own, so it sits at home next to the
 * call tree and the classic-operation steps instead of looking like a
 * table dropped in from another page.
 */
function StateChangeStep({ change }: { change: TraceStateChange }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {change.contract ? <Address value={change.contract} /> : null}
      <StateChangeKind kind={change.kind} />
      {change.durability ? (
        <span className="text-muted-foreground">{change.durability}</span>
      ) : null}
      <span className="text-muted-foreground">data</span>
      {change.key ? (
        <code className="font-mono">
          <ScValView value={change.key} />
        </code>
      ) : null}
      {change.value === undefined ? null : (
        <>
          <span className="text-muted-foreground">=</span>
          <code className="font-mono">
            <ScValView value={change.value} />
          </code>
        </>
      )}
    </span>
  );
}

function TtlStep({ ttl }: { ttl: TraceTtl }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {ttl.contract ? <Address value={ttl.contract} /> : null}
      <span className="text-muted-foreground">
        {ttl.entry ?? "ledger"} entry
      </span>
      <span className="font-mono text-muted-foreground">
        {truncateMiddle(ttl.keyHash, 8)}
      </span>
      <span className="text-muted-foreground">kept until ledger</span>
      <Link
        to={appPath(`/ledger/${ttl.liveUntilLedger}`)}
        className="font-mono text-link transition-colors hover:text-link-hover"
      >
        {ttl.liveUntilLedger.toLocaleString("en-US")}
      </Link>
    </span>
  );
}

/** What a call wrote to storage: what changed, and how long it is kept. */
function StorageSteps({
  stateChanges,
  ttlExtensions,
}: {
  stateChanges: TraceStateChange[];
  ttlExtensions: TraceTtl[];
}) {
  return (
    <>
      <StepGroup label="State changes">
        {stateChanges.map((change, index) => (
          <StateChangeStep key={index} change={change} />
        ))}
      </StepGroup>
      <StepGroup label="Storage lifetime">
        {ttlExtensions.map((ttl, index) => (
          <TtlStep key={index} ttl={ttl} />
        ))}
      </StepGroup>
    </>
  );
}

/**
 * What the transaction moved, from the effects Horizon keeps for good. It is
 * the part of a transaction that survives the execution meta ageing out, so
 * an old contract call still says what changed hands. Grouped the same way
 * the storage steps above it are, so every section under the tree reads
 * consistently rather than this one alone sitting in a bare, lineless list.
 */
function BalanceMoves({ hash }: { hash: string }) {
  const effects = useQuery(txEffectsQuery(ACTIVE_NETWORK, hash));
  if (!effects.isSuccess) {
    return null;
  }
  const changes = netBalanceChanges(effects.data._embedded.records);
  return (
    <StepGroup label="Net change">
      {changes.map((change, index) => (
        <NetChangeLine key={index} change={change} />
      ))}
    </StepGroup>
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
    // a leaf call has no sub-calls or events for the tree to draw, but it
    // can still have written to storage; only once that is empty too is
    // there truly nothing this call did beyond what the row above said
    const hasSubActivity =
      trace !== null &&
      trace.calls.some(
        (call) => call.calls.length > 0 || call.events.length > 0,
      );
    const hasStorage =
      trace !== null &&
      (trace.stateChanges.length > 0 || trace.ttlExtensions.length > 0);
    const hasNothing = trace !== null && !hasSubActivity && !hasStorage;
    return (
      <div className="pt-1">
        {trace === null ? (
          <p className="pb-2 text-muted-foreground">
            No call trace is available for this transaction.
          </p>
        ) : hasNothing ? (
          <p className="pb-2 text-muted-foreground">
            This call did not make any further calls, emit events, or change
            storage.
          </p>
        ) : (
          <>
            {/* a tree rebuilt from authorization data is not the execution,
                and saying so belongs wherever the tree is shown */}
            {trace.source === "auth" ? <AuthTraceNote /> : null}
            <CallTree calls={trace.calls} invoker={invoker} continuation />
            <StorageSteps
              stateChanges={trace.stateChanges}
              ttlExtensions={trace.ttlExtensions}
            />
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
 * What one transaction did, closed. A contract call reads as the call
 * itself, the way the call tree opens on the transaction page; a classic
 * transaction reads as a sentence. The row opens into the full detail,
 * which is the only part that needs a request of its own, so it is made
 * when the reader asks for it and not before. Shared between the account
 * page's history and the contract page's invocations, since both are one
 * transaction per row either way.
 */
export function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const record = entry.operations[0];
  const op = presentOperation(record);
  const invokes = isContractInvocation(record);
  const created = record.created_at;
  const fee = record.transaction?.fee_charged;
  // only an explicit false is a failure: horizon omits the flag on some
  // op shapes, and an unknown outcome must not be branded as one
  const failed =
    record.transaction_successful === false ||
    record.transaction?.successful === false;
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
        <span className="flex flex-col items-start gap-1">
          <OpTag family={op.family}>{op.label}</OpTag>
          {failed && <StatusChip successful={false} />}
        </span>
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

/** The band above the rows while a page loads, holding the pager's own height so nothing shifts on arrival. */
export function PagerSkeleton() {
  return (
    <div className="flex h-[3.25rem] items-center gap-2" aria-hidden="true">
      <Skeleton className="h-9 w-16 rounded-lg" />
      <Skeleton className="h-9 w-10 rounded-lg" />
      <Skeleton className="h-9 w-9 rounded-lg" />
      <Skeleton className="h-9 w-10 rounded-lg" />
    </div>
  );
}
