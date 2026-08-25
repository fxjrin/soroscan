import type { ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowRight, ChevronRight, Clock } from "lucide-react";
import { Address } from "@/components/address";
import { AssetIcon } from "@/components/asset-icon";
import { FunctionChip, OpTag, StatusChip } from "@/components/op-tag";
import { CopyButton } from "@/components/copy-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DataCell,
  DataRow,
  DataTable,
  NoValue,
  TableSkeleton,
  type Column,
} from "@/components/data-table";
import {
  CallTree,
  CallTreeSkeleton,
  EventSignature,
} from "@/components/call-tree";
import { JsonTree, JsonTreeSkeleton } from "@/components/json-tree";
import { CallSignature, ScValView } from "@/components/scval-view";
import { EntityShell, Row } from "@/features/entity-shell";
import { InvalidEntity } from "@/features/invalid-entity";
import {
  assetCodeOf,
  isContractInvocation,
  presentOperation,
  type PrimaryOp,
} from "@/lib/activity";
import {
  formatAgo,
  formatAmount,
  formatDecimalDisplay,
  formatTimestamp,
  formatXlmDisplay,
  sanitizeChainText,
  truncateMiddle,
} from "@/lib/format";
import {
  NotFoundError,
  type EffectRecord,
  type OperationRecord,
  type TxDetailRecord,
} from "@/lib/horizon/client";
import { ACTIVE_NETWORK, appPath } from "@/lib/network";
import {
  txEffectsQuery,
  txOperationsQuery,
  txQuery,
  txDecodedXdrQuery,
  txSorobanQuery,
  type SorobanDetails,
} from "@/lib/queries";
import { decodeScSymbol, decodeScVal } from "@/lib/scval";
import { addressHint, extractSignatureHints } from "@/lib/signatures";
import {
  countTraceCalls,
  type TraceFees,
  type TraceStateChange,
  type TraceTtl,
} from "@/lib/tx-trace";
import {
  balanceHolderOf,
  netBalanceChanges,
  operationIdOf,
} from "@/lib/balance-changes";
import { classifySearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/use-now";

function SectionBreak() {
  return <div className="my-3 border-t border-border/50" aria-hidden="true" />;
}

// one human sentence for what the transaction did, blockscout-style, built
// from the decoded primary operation; every piece is a direct flex item so
// word gaps and vertical centering stay uniform across the sentence
function ActionSummary({ op, opCount }: { op: PrimaryOp; opCount: number }) {
  let action: ReactNode;
  switch (op.type) {
    case "payment":
    case "path_payment_strict_send":
    case "path_payment_strict_receive":
      action =
        op.amount && op.assetCode && op.to ? (
          <>
            <span>{`sent ${formatDecimalDisplay(op.amount)} ${op.assetCode} to`}</span>
            <Address value={op.to} />
          </>
        ) : (
          <span>sent a payment</span>
        );
      break;
    case "invoke_host_function":
      action = (
        <>
          <span>called</span>
          {op.detail ? (
            <FunctionChip name={op.detail} />
          ) : (
            <span className="font-mono">a function</span>
          )}
          <span>on</span>
          {op.to ? <Address value={op.to} /> : <span>a contract</span>}
        </>
      );
      break;
    case "create_account":
      action =
        op.to && op.amount ? (
          <>
            <span>created account</span>
            <Address value={op.to} />
            <span>{`with ${formatDecimalDisplay(op.amount)} XLM`}</span>
          </>
        ) : (
          <span>created an account</span>
        );
      break;
    default:
      action = <span>{`performed ${op.label.toLowerCase()}`}</span>;
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {op.from ? <Address value={op.from} /> : null}
      {action}
      {opCount > 1 ? (
        <span className="text-muted-foreground">
          and {opCount - 1} more {opCount === 2 ? "operation" : "operations"}
        </span>
      ) : null}
    </p>
  );
}

// blockscout-style decoded call: the function, its arguments from the
// operation parameters, and the return value from the transaction meta
function FunctionCall({
  record,
  soroban,
}: {
  record: OperationRecord;
  soroban: UseQueryResult<SorobanDetails>;
}) {
  const params = record.parameters ?? [];
  const name = decodeScSymbol(params[1]?.value ?? "");
  if (name === undefined) {
    return null;
  }
  const args = params.slice(2).map((param) => decodeScVal(param.value));
  const returnValue =
    soroban.isSuccess &&
    soroban.data.returnValue !== null &&
    soroban.data.returnValue.type !== "void"
      ? soroban.data.returnValue
      : undefined;
  return (
    <>
      <SectionBreak />
      <Row
        label="Function call"
        hint="The invoked function with its decoded arguments, and the value it returned. The return value comes from the RPC providers, so it is missing for transactions older than their retention window."
      >
        {/* the tint has padding of its own, pulled back so the call starts
            on the same x as every other value in the column */}
        <span className="-ms-1.5">
          <CallSignature
            standalone
            name={name}
            args={args}
            result={returnValue}
          />
        </span>
      </Row>
    </>
  );
}

function TraceSectionLabel({ children }: { children: ReactNode }) {
  return <p className="pb-2 pt-5 font-medium text-foreground/80">{children}</p>;
}

const STATE_CHANGE_STYLES: Record<TraceStateChange["kind"], string> = {
  created: "text-emerald-700 dark:text-emerald-400",
  updated: "text-muted-foreground",
  restored: "text-sky-700 dark:text-sky-400",
  removed: "text-red-600 dark:text-red-400",
};

function StateChangeRow({ change }: { change: TraceStateChange }) {
  return (
    <DataRow>
      <DataCell>
        <span className={STATE_CHANGE_STYLES[change.kind]}>{change.kind}</span>
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

const RESOURCE_ROWS: Array<{ key: string; label: string; bytes?: boolean }> = [
  { key: "read_entry", label: "Entries read" },
  { key: "write_entry", label: "Entries written" },
  { key: "ledger_read_byte", label: "Ledger read", bytes: true },
  { key: "ledger_write_byte", label: "Ledger written", bytes: true },
  { key: "read_key_byte", label: "Keys read", bytes: true },
  { key: "write_key_byte", label: "Keys written", bytes: true },
  { key: "read_data_byte", label: "Data read", bytes: true },
  { key: "write_data_byte", label: "Data written", bytes: true },
  { key: "read_code_byte", label: "Code read", bytes: true },
  { key: "write_code_byte", label: "Code written", bytes: true },
  { key: "cpu_insn", label: "Instructions" },
  { key: "mem_byte", label: "Memory used", bytes: true },
];

function formatNanosAsMs(raw: string): string {
  if (!/^\d+$/.test(raw)) {
    return sanitizeChainText(raw);
  }
  const hundredthsOfMs = BigInt(raw) / 10_000n;
  const whole = (hundredthsOfMs / 100n).toString();
  const fraction = (hundredthsOfMs % 100n).toString().padStart(2, "0");
  return `${formatAmount(whole, 0)}.${fraction} ms`;
}

function ResourceCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

// the host measures what an invocation actually consumed and reports it
// through core_metrics diagnostic events; the fee split comes from the meta
function ResourcesSection({
  metrics,
  fees,
}: {
  metrics: Record<string, string>;
  fees?: TraceFees;
}) {
  const rows = RESOURCE_ROWS.filter((row) => metrics[row.key] !== undefined);
  const eventCount = metrics["emit_event"];
  const eventBytes = metrics["emit_event_byte"];
  const invokeNs = metrics["invoke_time_nsecs"];
  if (rows.length === 0 && eventCount === undefined && fees === undefined) {
    return null;
  }
  return (
    <>
      <TraceSectionLabel>Resources</TraceSectionLabel>
      <dl className="grid grid-cols-1 gap-x-10 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((row) => (
          <ResourceCell
            key={row.key}
            label={row.label}
            value={formatAmount(metrics[row.key], 0) + (row.bytes ? " B" : "")}
          />
        ))}
        {eventCount !== undefined ? (
          <ResourceCell
            label="Events emitted"
            value={
              formatAmount(eventCount, 0) +
              (eventBytes !== undefined
                ? ` (${formatAmount(eventBytes, 0)} B)`
                : "")
            }
          />
        ) : null}
        {invokeNs !== undefined ? (
          <ResourceCell label="Invoke time" value={formatNanosAsMs(invokeNs)} />
        ) : null}
        {fees ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:col-span-full">
            <dt className="text-muted-foreground">Resource fees</dt>
            <dd className="font-mono">
              {formatAmount(fees.nonRefundable, 0)}
              <span className="text-muted-foreground"> non-refundable + </span>
              {formatAmount(fees.refundable, 0)}
              <span className="text-muted-foreground"> refundable + </span>
              {formatAmount(fees.rent, 0)}
              <span className="text-muted-foreground"> rent stroops</span>
            </dd>
          </div>
        ) : null}
      </dl>
    </>
  );
}

function TracePanel({
  soroban,
  invoker,
  settled,
  invokes,
}: {
  soroban: UseQueryResult<SorobanDetails>;
  invoker: string;
  /** whether the operations have answered whether this is a contract call */
  settled: boolean;
  invokes: boolean;
}) {
  if (!settled || (invokes && soroban.isPending)) {
    return (
      <div>
        <TraceSectionLabel>Call tree</TraceSectionLabel>
        <CallTreeSkeleton />
      </div>
    );
  }
  if (!invokes) {
    return (
      <p className="text-muted-foreground">
        This transaction did not call a contract, so it has no call trace.
      </p>
    );
  }
  if (soroban.isError) {
    return (
      <p className="text-muted-foreground">
        Could not load the call trace; the data providers are unreachable.
      </p>
    );
  }
  const trace = soroban.data?.trace ?? null;
  if (trace === null) {
    return (
      <p className="text-muted-foreground">
        No call trace is available for this transaction.
      </p>
    );
  }
  return (
    <div>
      {trace.source === "auth" && trace.calls.length > 0 ? (
        <p className="pb-3 text-muted-foreground">
          Reconstructed from the transaction's signed authorization data: only
          sub-calls that required authorization appear, and return values are
          unknown.
        </p>
      ) : null}
      {trace.truncated ? (
        <p className="pb-3 text-muted-foreground">
          This trace is unusually large; only its first entries are shown.
        </p>
      ) : null}
      {trace.calls.length > 0 ? (
        <>
          <TraceSectionLabel>Call tree</TraceSectionLabel>
          <CallTree calls={trace.calls} invoker={invoker} />
        </>
      ) : null}
      {trace.events.length > 0 ? (
        <>
          <TraceSectionLabel>Events</TraceSectionLabel>
          <p className="pb-2 text-muted-foreground">
            The diagnostic stream is unavailable, so these events cannot be
            attributed to a specific call.
          </p>
          <DataTable
            minWidth="min-w-[40rem]"
            columns={[{ label: "Contract" }, { label: "Event" }]}
          >
            {trace.events.map((event, index) => (
              <DataRow key={index}>
                <DataCell>
                  {event.contract ? (
                    <Address value={event.contract} />
                  ) : (
                    <NoValue />
                  )}
                </DataCell>
                <DataCell>
                  <EventSignature event={event} />
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        </>
      ) : null}
      {trace.stateChanges.length > 0 ? (
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
            {trace.stateChanges.map((change, index) => (
              <StateChangeRow key={index} change={change} />
            ))}
          </DataTable>
        </>
      ) : null}
      {trace.ttlExtensions.length > 0 ? (
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
            {trace.ttlExtensions.map((ttl, index) => (
              <TtlRow key={index} ttl={ttl} />
            ))}
          </DataTable>
        </>
      ) : null}
      <ResourcesSection metrics={trace.metrics} fees={trace.fees} />
    </div>
  );
}

// a hint is the last 4 bytes of the signer's public key; matching it
// against the accounts this page already knows names the signer without
// fetching anything extra
function SignatureRows({ tx }: { tx: TxDetailRecord }) {
  const signatures = tx.signatures ?? [];
  const decorated =
    tx.envelope_xdr === undefined
      ? undefined
      : extractSignatureHints(tx.envelope_xdr, signatures);
  const signerByHint = new Map<string, string>();
  for (const account of [tx.source_account, tx.fee_account]) {
    const hint = account === undefined ? undefined : addressHint(account);
    if (hint !== undefined && account !== undefined) {
      signerByHint.set(hint, account);
    }
  }
  return (
    <Row
      label="Signatures"
      hint="The base64 signatures from the envelope. Each carries a hint, the last 4 bytes of the signing key, which names the signer when it matches an account this page knows."
    >
      {signatures.length === 0 ? (
        "0"
      ) : (
        <ol className="flex flex-col gap-1.5">
          {signatures.map((signature, index) => {
            const hint = decorated?.[index]?.hint;
            const signer =
              hint === undefined ? undefined : signerByHint.get(hint);
            return (
              <li
                key={index}
                className="flex flex-wrap items-center gap-x-2 gap-y-1"
              >
                {signer !== undefined ? (
                  <Address value={signer} />
                ) : hint !== undefined ? (
                  <span className="font-mono text-muted-foreground">
                    hint {hint}
                  </span>
                ) : null}
                <bdi className="font-mono text-muted-foreground">
                  {truncateMiddle(sanitizeChainText(signature), 12)}
                </bdi>
                <CopyButton value={signature} label="Copy signature" />
              </li>
            );
          })}
        </ol>
      )}
    </Row>
  );
}

function FeeValue({ stroops }: { stroops: string }) {
  return (
    <span className="font-mono">
      {formatXlmDisplay(stroops)} XLM{" "}
      <span className="text-muted-foreground">
        ({sanitizeChainText(stroops)} stroops)
      </span>
    </span>
  );
}

// the labels of a transaction are known before its data is: only the value
// side is unknown while it loads, so the placeholder renders the real rows
// and leaves a bar where each value will land. Rows that depend on what the
// transaction did stay out until there is a transaction to ask
// the open tab lives in the url so a link carries it; anything unknown, and
// the trace tab on a transaction that has none, fall back to the overview
const TAB_PARAM = "tab";
const DEFAULT_TAB = "details";
const SHAREABLE_TABS = [
  DEFAULT_TAB,
  "trace",
  "balance-changes",
  "operations",
  "xdr",
  "decoded",
];

/** The tab the url asks for, whether or not this transaction has it. */
function requestedTab(params: URLSearchParams): string {
  const tab = params.get(TAB_PARAM) ?? DEFAULT_TAB;
  return SHAREABLE_TABS.includes(tab) ? tab : DEFAULT_TAB;
}

// label and hint of every row the placeholder also renders, so the two
// cannot describe a row differently or leave the hint icon out of one
const ROW = {
  hash: {
    label: "Transaction hash",
    hint: "The unique identifier of this transaction, a SHA-256 of its contents.",
  },
  status: {
    label: "Status and operation",
    hint: "Whether the network applied this transaction, and the kind of its first operation. A failed transaction changes nothing but still pays its fee.",
  },
  ledger: {
    label: "Ledger",
    hint: "The ledger this transaction was sealed in. A ledger is Stellar's block, and finality is immediate: once sealed, a transaction can never be reorged away.",
  },
  timestamp: {
    label: "Timestamp",
    hint: "When the ledger holding this transaction closed, as reported by the network.",
  },
  from: {
    label: "From",
    hint: "The source account: it authorized and sequenced this transaction.",
  },
  fee: {
    label: "Transaction fee",
    hint: "Deducted from the fee payer and permanently burned; Stellar has no miners to pay.",
  },
  operations: {
    label: "Operations",
    hint: "How many operations this transaction carries; each one settles or fails with the transaction as a whole.",
  },
};

// a placeholder sits inside a line box of the row's own height, so a page of
// them is exactly as tall as the page of text it stands in for
function ValueBar({ className }: { className?: string }) {
  return (
    <span className="flex h-[1lh] items-center">
      <Skeleton className={cn("h-5", className)} />
    </span>
  );
}

const TAB_PLACEHOLDER_WIDTHS = ["w-12", "w-10", "w-24", "w-20", "w-8", "w-16"];

function DetailRowsSkeleton() {
  return (
    <dl>
      <Row {...ROW.hash}>
        <ValueBar className="w-full max-w-[34rem]" />
      </Row>
      <Row {...ROW.status}>
        <span className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-6 w-28 rounded-sm" />
          <Skeleton className="h-6 w-32 rounded-sm" />
        </span>
      </Row>
      <Row {...ROW.ledger}>
        <ValueBar className="w-36" />
      </Row>
      <Row {...ROW.timestamp}>
        <ValueBar className="w-64" />
      </Row>
      <SectionBreak />
      <Row {...ROW.from}>
        <ValueBar className="w-full max-w-[30rem]" />
      </Row>
      <SectionBreak />
      <Row {...ROW.fee}>
        <ValueBar className="w-52" />
      </Row>
      <Row {...ROW.operations}>
        <ValueBar className="w-8" />
      </Row>
      <div className="mt-3 flex items-center gap-1 text-muted-foreground">
        <ChevronRight className="size-3.5" aria-hidden="true" />
        More details
      </div>
    </dl>
  );
}

function XdrSkeleton() {
  return (
    <div aria-hidden="true">
      {["h-24", "h-16", "h-32"].map((height) => (
        <div key={height} className="py-3">
          <div className="flex items-center gap-2">
            <ValueBar className="w-24" />
            <ValueBar className="w-20" />
          </div>
          <div className="mt-0.5">
            <ValueBar className="w-full max-w-[32rem]" />
          </div>
          <Skeleton className={cn("mt-1 w-full rounded-lg", height)} />
        </div>
      ))}
    </div>
  );
}

function TabBodySkeleton({ tab }: { tab: string }) {
  switch (tab) {
    case "trace":
      return (
        <div>
          <TraceSectionLabel>Call tree</TraceSectionLabel>
          <CallTreeSkeleton />
        </div>
      );
    case "balance-changes":
      return (
        <TableSkeleton columns={BALANCE_COLUMNS} minWidth={BALANCE_MIN_WIDTH} />
      );
    case "operations":
      return (
        <TableSkeleton
          columns={OPERATION_COLUMNS}
          minWidth={OPERATIONS_MIN_WIDTH}
          rows={2}
        />
      );
    case "xdr":
      return <XdrSkeleton />;
    case "decoded":
      return (
        <div className="rounded-lg bg-muted/60 p-3 font-mono text-xs">
          <JsonTreeSkeleton />
        </div>
      );
    default:
      return <DetailRowsSkeleton />;
  }
}

/**
 * The page before its data: the real tab strip with placeholder pills, and
 * under it the shape of whichever tab the url asked for, so a shared link
 * never loads one tab and then swaps to another.
 */
function TxSkeleton({ tab }: { tab: string }) {
  return (
    // the real Tabs render the strip, so its height cannot drift from the
    // loaded page the way a hand-sized placeholder would
    <Tabs value={tab}>
      <TabsList className="h-auto gap-2 bg-transparent p-0">
        {TAB_PLACEHOLDER_WIDTHS.map((width) => (
          <TabsTrigger key={width} value={width} className={TAB_PILL} disabled>
            <ValueBar className={width} />
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={tab} className="pt-5">
        <TabBodySkeleton tab={tab} />
      </TabsContent>
    </Tabs>
  );
}

function Overview({
  tx,
  primaryOp,
  now,
  call,
}: {
  tx: TxDetailRecord;
  primaryOp?: PrimaryOp;
  now: number;
  call?: ReactNode;
}) {
  const feeBumped =
    tx.fee_account !== undefined &&
    tx.fee_account !== "" &&
    tx.fee_account !== tx.source_account;
  return (
    <dl>
      <Row {...ROW.hash}>
        <Address value={tx.hash} full />
      </Row>
      <Row {...ROW.status}>
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip successful={tx.successful} />
          {primaryOp ? (
            <OpTag family={primaryOp.family}>{primaryOp.label}</OpTag>
          ) : null}
        </span>
      </Row>
      <Row {...ROW.ledger}>
        {Number.isFinite(tx.ledger) ? (
          <Link
            to={appPath(`/ledger/${tx.ledger}`)}
            className="text-link transition-colors hover:text-link-hover"
          >
            {Number(tx.ledger).toLocaleString("en-US")}
          </Link>
        ) : (
          "-"
        )}{" "}
        <span className="text-muted-foreground">{"\u00b7"} final</span>
      </Row>
      <Row {...ROW.timestamp}>
        <span className="flex flex-wrap items-center gap-1.5">
          <Clock
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          {formatAgo(tx.created_at, now)}
          <span className="text-muted-foreground">
            {formatTimestamp(tx.created_at)}
          </span>
        </span>
      </Row>
      <SectionBreak />
      <Row {...ROW.from}>
        <Address value={tx.source_account} full />
      </Row>
      {primaryOp?.to && !primaryOp.to.startsWith("G") ? (
        <Row
          label="Interacted with"
          hint="The contract invoked by this transaction's first operation."
        >
          <Address value={primaryOp.to} full />
        </Row>
      ) : null}
      {feeBumped ? (
        <Row
          label="Fee paid by"
          hint="A different account sponsored the fee for this transaction (fee bump)."
        >
          <Address value={tx.fee_account ?? ""} full />
        </Row>
      ) : null}
      {tx.memo_type !== "none" ? (
        <Row
          label="Memo"
          hint="Free-form data attached by the sender. Anyone can write anything here; never trust it."
        >
          <bdi>{sanitizeChainText(tx.memo ?? "")}</bdi>{" "}
          <span className="text-muted-foreground">
            ({sanitizeChainText(tx.memo_type)})
          </span>
        </Row>
      ) : null}
      {call}
      <SectionBreak />
      {tx.operation_count === 1 && primaryOp?.amount ? (
        <Row
          label="Value"
          hint="The amount moved by this transaction's single operation."
        >
          <span className="font-mono">
            {formatDecimalDisplay(primaryOp.amount)} {primaryOp.assetCode ?? ""}
          </span>
        </Row>
      ) : null}
      <Row {...ROW.fee}>
        <FeeValue stroops={tx.fee_charged} />
      </Row>
      <Row {...ROW.operations}>{tx.operation_count}</Row>
      <details className="group mt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground transition-colors hover:text-foreground">
          <ChevronRight
            className="size-3.5 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
          More details
        </summary>
        <div className="mt-1">
          <Row
            label="Max fee"
            hint="The most the sender was willing to pay. The charged fee can be lower when the network is not busy."
          >
            <FeeValue stroops={tx.max_fee} />
          </Row>
          <Row
            label="Sequence"
            hint="The source account's sequence number consumed by this transaction; it orders an account's transactions."
          >
            <bdi className="font-mono">
              {sanitizeChainText(tx.source_account_sequence)}
            </bdi>
          </Row>
          <SignatureRows tx={tx} />
        </div>
      </details>
    </dl>
  );
}

// ledger, time, and fee are properties of the transaction, so every row
// repeats them; they are columns anyway because a reader scanning one
// operation should not have to look elsewhere for when and what it cost
const OPERATION_COLUMNS: Column[] = [
  { label: "Type" },
  { label: "Method" },
  { label: "Ledger" },
  { label: "From / To" },
  { label: "Value", numeric: true },
  { label: "Fee", numeric: true },
];

const OPERATIONS_MIN_WIDTH = "min-w-[56rem]";

function OperationsTable({
  rows,
  tx,
}: {
  rows: Array<{ id: string; op: PrimaryOp }>;
  tx: TxDetailRecord;
}) {
  return (
    <DataTable minWidth={OPERATIONS_MIN_WIDTH} columns={OPERATION_COLUMNS}>
      {rows.map(({ id, op }) => (
        <DataRow key={id}>
          <DataCell>
            <OpTag family={op.family}>{op.label}</OpTag>
          </DataCell>
          <DataCell>
            {op.detail ? <FunctionChip name={op.detail} /> : <NoValue />}
          </DataCell>
          <DataCell>
            {Number.isFinite(tx.ledger) ? (
              <Link
                to={appPath(`/ledger/${tx.ledger}`)}
                className="font-mono text-link transition-colors hover:text-link-hover"
              >
                {Number(tx.ledger).toLocaleString("en-US")}
              </Link>
            ) : (
              <NoValue />
            )}
          </DataCell>
          <DataCell>
            {op.from ? (
              <span className="flex min-w-0 items-center gap-2">
                <Address value={op.from} />
                {op.to ? (
                  <>
                    <ArrowRight
                      className="size-3.5 shrink-0 text-muted-foreground/60"
                      aria-hidden="true"
                    />
                    <Address value={op.to} />
                  </>
                ) : op.toHint ? (
                  <>
                    <ArrowRight
                      className="size-3.5 shrink-0 text-muted-foreground/60"
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground">{op.toHint}</span>
                  </>
                ) : null}
              </span>
            ) : (
              <NoValue />
            )}
          </DataCell>
          <DataCell numeric>
            {op.amount ? (
              <span className="inline-flex items-center gap-1.5 font-mono">
                {op.assetCode ? (
                  <AssetIcon code={op.assetCode} size={14} />
                ) : null}
                {formatDecimalDisplay(op.amount)}
                {op.assetCode ? (
                  <span className="text-muted-foreground">{op.assetCode}</span>
                ) : null}
              </span>
            ) : (
              <NoValue />
            )}
          </DataCell>
          <DataCell numeric>
            <span className="inline-flex items-center gap-1.5 font-mono">
              {formatXlmDisplay(tx.fee_charged)}
              <span className="text-muted-foreground">XLM</span>
            </span>
          </DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
}

const TAB_PILL =
  "flex-none rounded-lg px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-foreground data-[state=active]:text-background dark:data-[state=active]:bg-foreground dark:data-[state=active]:text-background data-[state=active]:shadow-none";

function BalanceDelta({ effect }: { effect: EffectRecord }) {
  const credited = effect.type.endsWith("credited");
  const code = assetCodeOf(effect.asset_type, effect.asset_code) ?? "";
  return (
    <span
      className={
        credited
          ? "inline-flex items-center gap-1.5 font-mono text-emerald-700 dark:text-emerald-400"
          : "inline-flex items-center gap-1.5 font-mono text-red-600 dark:text-red-400"
      }
    >
      {code ? <AssetIcon code={code} size={14} /> : null}
      <span>
        {credited ? "+" : "-"}
        {formatDecimalDisplay(effect.amount ?? "")} {code}
      </span>
    </span>
  );
}

// the itemised rows say what moved; this says what each account is left
// with, which is the question a payout split across many effects makes
// hard to answer by eye
function NetChanges({ effects }: { effects: EffectRecord[] }) {
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
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            <Address value={change.holder} />
            <span
              className={
                change.amount.startsWith("-")
                  ? "inline-flex items-center gap-1.5 font-mono text-red-600 dark:text-red-400"
                  : "inline-flex items-center gap-1.5 font-mono text-emerald-700 dark:text-emerald-400"
              }
            >
              <AssetIcon code={change.assetCode} size={14} />
              <span>
                {change.amount.startsWith("-") ? "" : "+"}
                {change.amount} {change.assetCode}
              </span>
            </span>
            {change.assetIssuer ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                issued by
                <Address value={change.assetIssuer} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

// an effect names the operation it came out of; in a transaction that
// runs several operations this is the only per-effect field that varies
function SourceOperation({
  record,
  causedBy,
}: {
  record: EffectRecord;
  causedBy: Map<string, OperationRecord>;
}) {
  const source = causedBy.get(operationIdOf(record) ?? "");
  if (source === undefined) {
    return <span className="text-muted-foreground/50">-</span>;
  }
  const op = presentOperation(source);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <OpTag family={op.family}>{op.label}</OpTag>
      {op.detail ? <FunctionChip name={op.detail} /> : null}
    </span>
  );
}

// a contract effect names the caller in `account` and the contract whose
// balance moved in `contract`; the row is about the latter
const BALANCE_COLUMNS: Column[] = [
  { label: "Holder" },
  { label: "Effect" },
  { label: "From operation" },
  { label: "Amount", numeric: true },
];

const BALANCE_MIN_WIDTH = "min-w-[48rem]";

function BalanceHolder({ effect }: { effect: EffectRecord }) {
  const holder = balanceHolderOf(effect);
  return holder ? <Address value={holder} /> : <NoValue />;
}

function BalanceChanges({
  hash,
  operations,
}: {
  hash: string;
  operations: OperationRecord[];
}) {
  const effects = useQuery(txEffectsQuery(ACTIVE_NETWORK, hash));
  if (effects.isPending) {
    return (
      <TableSkeleton columns={BALANCE_COLUMNS} minWidth={BALANCE_MIN_WIDTH} />
    );
  }
  if (effects.isError) {
    return (
      <p className="text-muted-foreground">
        Could not load the balance changes; the data providers are unreachable.
      </p>
    );
  }
  const causedBy = new Map(operations.map((record) => [record.id, record]));
  const rows = effects.data._embedded.records.filter(
    (record) =>
      record.type.endsWith("credited") || record.type.endsWith("debited"),
  );
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground">
        No balance changes were recorded for this transaction.
      </p>
    );
  }
  return (
    <>
      <NetChanges effects={rows} />
      <DataTable minWidth={BALANCE_MIN_WIDTH} columns={BALANCE_COLUMNS}>
        {rows.map((record) => (
          <DataRow key={record.id}>
            <DataCell>
              <BalanceHolder effect={record} />
            </DataCell>
            <DataCell className="text-muted-foreground">
              {sanitizeChainText(record.type).replace(/_/g, " ")}
            </DataCell>
            <DataCell>
              <SourceOperation record={record} causedBy={causedBy} />
            </DataCell>
            <DataCell numeric>
              <BalanceDelta effect={record} />
            </DataCell>
          </DataRow>
        ))}
      </DataTable>
    </>
  );
}

// the lab keeps its whole ui state in one query parameter and reads that
// parameter straight off the raw url, so nothing here is percent-encoded.
// its own escape character is a slash, which base64 also uses, so every
// slash in a blob has to be doubled or the value ends short
function labViewerUrl(value: string, type: string): string {
  return `https://lab.stellar.org/xdr/view?$=xdr$blob=${value.replaceAll("/", "//")}&type=${type};;`;
}

// provider data is untrusted; anything that is not plain base64 stays out
// of the raw url entirely
const BASE64_SHAPE = /^[A-Za-z0-9+/]+={0,2}$/;

function XdrBlob({
  label,
  value,
  type,
  description,
}: {
  label: string;
  value?: string;
  type: string;
  description: string;
}) {
  if (value === undefined || value === "") {
    return null;
  }
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-foreground/80">{label}</span>
        <CopyButton value={value} label={`Copy ${label}`} />
        <span className="text-muted-foreground">
          {Math.floor((value.length * 3) / 4).toLocaleString("en-US")} bytes
        </span>
        {BASE64_SHAPE.test(value) ? (
          <a
            href={labViewerUrl(value, type)}
            target="_blank"
            rel="noopener noreferrer"
            className="ms-auto text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Decode in Stellar Lab
          </a>
        ) : null}
      </div>
      <p className="mt-0.5 text-muted-foreground">{description}</p>
      <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-muted/60 p-3 font-mono text-muted-foreground">
        {sanitizeChainText(value)}
      </pre>
    </div>
  );
}

// the raw tab hands the blob to a decoder elsewhere; this one answers
// the same question in place, using the sdk's own json walker so 64-bit
// fields arrive as strings rather than rounded numbers
function DecodedSection({
  label,
  description,
  value,
}: {
  label: string;
  description: string;
  value: unknown;
}) {
  if (value === undefined) {
    return null;
  }
  return (
    <details className="border-b border-border/50 py-3 last:border-b-0" open>
      <summary className="cursor-pointer list-none">
        <span className="font-medium text-foreground/80">{label}</span>
        <p className="mt-0.5 text-muted-foreground">{description}</p>
      </summary>
      <div className="mt-2 overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-xs">
        <JsonTree value={value} />
      </div>
    </details>
  );
}

function DecodedPanel({ tx }: { tx: TxDetailRecord }) {
  const decoded = useQuery(
    txDecodedXdrQuery(ACTIVE_NETWORK, tx.hash, {
      envelope: tx.envelope_xdr,
      result: tx.result_xdr,
      feeMeta: tx.fee_meta_xdr,
    }),
  );
  if (decoded.isPending) {
    return (
      <div className="rounded-lg bg-muted/60 p-3 font-mono text-xs">
        <JsonTreeSkeleton />
      </div>
    );
  }
  if (decoded.isError) {
    return (
      <p className="text-muted-foreground">
        Could not decode this transaction&apos;s XDR.
      </p>
    );
  }
  const nothing =
    decoded.data.envelope === undefined &&
    decoded.data.result === undefined &&
    decoded.data.feeMeta === undefined;
  if (nothing) {
    return (
      <p className="text-muted-foreground">
        The data providers returned no XDR for this transaction to decode.
      </p>
    );
  }
  return (
    <div>
      <p className="pb-2 text-muted-foreground">
        The same blobs as the XDR tab, decoded into the structure the network
        stores. Numbers wider than 53 bits stay strings so none of them is
        rounded on the way here.
      </p>
      <DecodedSection
        label="Envelope"
        description="The signed transaction as submitted: source, operations, and signatures."
        value={decoded.data.envelope}
      />
      <DecodedSection
        label="Result"
        description="What the network decided: the outcome code per operation and the fee charged."
        value={decoded.data.result}
      />
      <DecodedSection
        label="Fee meta"
        description="The ledger entries the fee payment itself changed."
        value={decoded.data.feeMeta}
      />
    </div>
  );
}

function XdrPanel({ tx }: { tx: TxDetailRecord }) {
  return (
    <div>
      <p className="pb-2 text-muted-foreground">
        XDR is the binary format the network itself stores, shown here
        base64-encoded exactly as the data provider returned it.
      </p>
      <XdrBlob
        label="Envelope"
        value={tx.envelope_xdr}
        type="TransactionEnvelope"
        description="The signed transaction as submitted: source, operations, and signatures."
      />
      <XdrBlob
        label="Result"
        value={tx.result_xdr}
        type="TransactionResult"
        description="What the network decided: the outcome code per operation and the fee charged."
      />
      <XdrBlob
        label="Fee meta"
        value={tx.fee_meta_xdr}
        type="LedgerEntryChanges"
        description="The ledger entries the fee payment itself changed."
      />
    </div>
  );
}

export function TxPage() {
  const now = useNow();
  const { hash = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const target = classifySearch(hash);
  const valid = target.type === "tx";

  const tx = useQuery({
    ...txQuery(ACTIVE_NETWORK, target.value),
    enabled: valid,
  });
  const operations = useQuery({
    ...txOperationsQuery(ACTIVE_NETWORK, target.value),
    enabled: valid && tx.isSuccess,
  });
  const firstRecord =
    tx.isSuccess && operations.isSuccess
      ? operations.data._embedded.records[0]
      : undefined;
  const invokes =
    firstRecord !== undefined && isContractInvocation(firstRecord);
  const soroban = useQuery({
    ...txSorobanQuery(ACTIVE_NETWORK, target.value, tx.data?.envelope_xdr),
    enabled: invokes,
  });

  if (!valid) {
    return <InvalidEntity expected="transaction hash" value={hash} />;
  }

  const traceCount =
    soroban.isSuccess && soroban.data.trace !== null
      ? countTraceCalls(soroban.data.trace.calls)
      : 0;

  const wanted = requestedTab(params);

  let body: ReactNode;
  if (tx.isPending) {
    body = <TxSkeleton tab={wanted} />;
  } else if (tx.isSuccess) {
    const primaryOp =
      firstRecord !== undefined ? presentOperation(firstRecord) : undefined;
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
          // switching tabs is not a step in the reader's journey, so back
          // leaves the transaction rather than walking the tabs they opened
          setParams(next, { replace: true });
        }}
      >
        <TabsList className="h-auto gap-2 bg-transparent p-0">
          <TabsTrigger value="details" className={TAB_PILL}>
            Details
          </TabsTrigger>
          {/* the trace tab keeps its place from the first paint: whether a
              transaction has a trace is only known once its operations
              arrive, and appearing then would shuffle the strip */}
          <TabsTrigger value="trace" className={TAB_PILL}>
            Trace
            {traceCount > 0 ? (
              <span className="text-xs opacity-60">{traceCount}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="balance-changes" className={TAB_PILL}>
            Balance changes
          </TabsTrigger>
          <TabsTrigger value="operations" className={TAB_PILL}>
            Operations
            <span className="text-xs opacity-60">
              {tx.data.operation_count}
            </span>
          </TabsTrigger>
          <TabsTrigger value="xdr" className={TAB_PILL}>
            XDR
          </TabsTrigger>
          <TabsTrigger value="decoded" className={TAB_PILL}>
            Decoded
          </TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="pt-5">
          {tx.data.successful ? null : (
            <p className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-red-700 dark:text-red-400">
              This transaction failed: its state changes were rolled back, but
              the fee was still charged. Failure diagnostics land here soon.
            </p>
          )}
          <Overview
            tx={tx.data}
            primaryOp={primaryOp}
            now={now}
            call={
              invokes ? (
                <FunctionCall record={firstRecord} soroban={soroban} />
              ) : undefined
            }
          />
        </TabsContent>
        <TabsContent value="trace" className="pt-5">
          <TracePanel
            soroban={soroban}
            invoker={tx.data.source_account}
            // the soroban query only runs for a contract call, and a
            // disabled query never leaves pending, so the panel is told
            // whether an answer is still on its way
            settled={operations.isSuccess || operations.isError}
            invokes={invokes}
          />
        </TabsContent>
        <TabsContent value="balance-changes" className="pt-5">
          <BalanceChanges
            hash={target.value}
            operations={
              operations.isSuccess ? operations.data._embedded.records : []
            }
          />
        </TabsContent>
        <TabsContent value="operations" className="pt-5">
          {operations.isSuccess ? (
            <OperationsTable
              tx={tx.data}
              rows={operations.data._embedded.records.map((record) => ({
                id: record.id,
                op: presentOperation(record),
              }))}
            />
          ) : operations.isError ? (
            <p className="text-muted-foreground">
              Could not load the operations; the data providers are unreachable.
            </p>
          ) : (
            <TableSkeleton
              columns={OPERATION_COLUMNS}
              minWidth={OPERATIONS_MIN_WIDTH}
              rows={2}
            />
          )}
        </TabsContent>
        <TabsContent value="xdr" className="pt-5">
          <XdrPanel tx={tx.data} />
        </TabsContent>
        <TabsContent value="decoded" className="pt-5">
          <DecodedPanel tx={tx.data} />
        </TabsContent>
      </Tabs>
    );
  } else if (tx.error instanceof NotFoundError) {
    body = (
      <p className="text-muted-foreground">
        This transaction is not in the provider's history. A just-submitted
        transaction can take a few seconds to appear; this page keeps checking
        automatically.
      </p>
    );
  } else {
    body = (
      <p className="text-muted-foreground">
        Could not load this transaction; the data providers are unreachable.
      </p>
    );
  }

  const summary =
    tx.isSuccess &&
    operations.isSuccess &&
    operations.data._embedded.records.length > 0 ? (
      <ActionSummary
        op={presentOperation(operations.data._embedded.records[0])}
        opCount={tx.data.operation_count}
      />
    ) : undefined;

  // the slot under the title holds one line whatever happens, so nothing
  // below it rises and drops: a placeholder while the sentence is still
  // being fetched, and the hash itself only when there will never be one
  const identifier =
    summary !== undefined ? undefined : tx.isPending ||
      (tx.isSuccess && operations.isPending) ? (
      <ValueBar className="w-full max-w-[26rem]" />
    ) : (
      <Address value={target.value} full />
    );

  return (
    <EntityShell
      title="Transaction details"
      identifier={identifier}
      summary={summary}
    >
      {body}
    </EntityShell>
  );
}
