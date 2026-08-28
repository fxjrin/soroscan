import type { ReactNode } from "react";
import { useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Address } from "@/components/address";
import { DataTable, TableSkeleton } from "@/components/data-table";
import { ScValView } from "@/components/scval-view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EntityShell, Row, ValueBar } from "@/features/entity-shell";
import { HistoryRow, Pager, PagerSkeleton } from "@/features/history-table";
import {
  HISTORY_COLUMNS,
  HISTORY_MIN_WIDTH,
  PAGED_TABLE,
} from "@/features/history-table-layout";
import { InvalidEntity } from "@/features/invalid-entity";
import { classifySearch } from "@/lib/search";
import { formatAmount, truncateMiddle } from "@/lib/format";
import { ACTIVE_NETWORK, appPath } from "@/lib/network";
import {
  contractCodeQuery,
  contractInstanceQuery,
  contractInvocationsQuery,
  EVENTS_PAGE,
  LEDGERS_PER_DAY,
  type ContractCodeDetails,
  type ContractInstanceDetails,
} from "@/lib/queries";
import type {
  ContractErrorCase,
  ContractErrorEnum,
  ContractExecutable,
  ContractFunctionSpec,
} from "@/lib/contract";
import type { ScDisplay } from "@/lib/scval";
import { useCursorPages } from "@/lib/use-cursor-pages";

const TAB_PARAM = "tab";
const DEFAULT_TAB = "details";
const SHAREABLE_TABS = [DEFAULT_TAB, "interface", "storage", "invocations"];

function requestedTab(params: URLSearchParams): string {
  const tab = params.get(TAB_PARAM) ?? DEFAULT_TAB;
  return SHAREABLE_TABS.includes(tab) ? tab : DEFAULT_TAB;
}

const TAB_PILL =
  "flex-none rounded-lg px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-foreground data-[state=active]:text-background dark:data-[state=active]:bg-foreground dark:data-[state=active]:text-background data-[state=active]:shadow-none";

function ledgerLink(sequence: number) {
  return (
    <Link
      to={appPath(`/ledger/${sequence}`)}
      className="font-mono text-link transition-colors hover:text-link-hover"
    >
      {sequence.toLocaleString("en-US")}
    </Link>
  );
}

/**
 * What the contract is: how it runs, what it carries as its own instance
 * storage, and how long the ledger keeps it around. A contract with no
 * live entry gets a plain explanation instead of an empty page, since an
 * absent entry can mean two different things chain data alone cannot
 * tell apart: never deployed, or deployed and since archived.
 */
function Details({
  data,
  code,
}: {
  data: ContractInstanceDetails;
  code: UseQueryResult<ContractCodeDetails>;
}) {
  const { instance, lastModifiedLedgerSeq, liveUntilLedgerSeq } = data;
  if (instance === undefined) {
    return (
      <p className="text-muted-foreground">
        No live entry was found for this contract. It may never have been
        deployed, or its storage may have expired and would need to be restored
        before it can be read again.
      </p>
    );
  }
  const storageCount = instance.storage.length;
  return (
    <dl>
      <Row
        label="Executable"
        hint="How this contract runs: its own WebAssembly code, or the built-in wrapper Soroban gives every classic asset."
      >
        {instance.executable.kind === "wasm" ? (
          <span className="flex flex-wrap items-center gap-2">
            WebAssembly
            <span className="font-mono text-muted-foreground">
              {truncateMiddle(instance.executable.wasmHash, 8)}
            </span>
          </span>
        ) : (
          <span>Stellar Asset Contract</span>
        )}
      </Row>
      {instance.executable.kind === "wasm" ? (
        <Row label="Code size">
          {code.isPending ? (
            <ValueBar className="w-20" />
          ) : code.data?.code ? (
            `${formatAmount(String(code.data.code.wasmBytes.length), 0)} B`
          ) : (
            <span className="text-muted-foreground">
              Could not load this contract's code.
            </span>
          )}
        </Row>
      ) : null}
      <Row
        label="Instance storage"
        hint="Key/value data attached directly to the contract's own instance entry, not counting any other storage entries it may keep under separate keys."
      >
        {storageCount} {storageCount === 1 ? "entry" : "entries"}
      </Row>
      {liveUntilLedgerSeq === undefined ? null : (
        <Row
          label="Live until ledger"
          hint="The ledger this instance expires at unless something extends it first. Past that ledger it is archived, not gone: restoring it brings it back."
        >
          {ledgerLink(liveUntilLedgerSeq)}
        </Row>
      )}
      {lastModifiedLedgerSeq === undefined ? null : (
        <Row
          label="Last updated ledger"
          hint="When this instance entry was last written. An upgrade rewrites it the same way a first deployment does, so this is not necessarily when the contract was first deployed."
        >
          {ledgerLink(lastModifiedLedgerSeq)}
        </Row>
      )}
    </dl>
  );
}

/** A function or error's own rustdoc comment, one `///` line per source line. */
function DocLines({ text }: { text: string }) {
  if (text.length === 0) {
    return null;
  }
  return (
    <div className="font-mono text-muted-foreground">
      {text.split("\n").map((line, index) => (
        <div key={index}>/// {line}</div>
      ))}
    </div>
  );
}

function FunctionSignature({ fn }: { fn: ContractFunctionSpec }) {
  return (
    <span className="font-mono">
      <span className="text-sky-700 dark:text-sky-400">fn</span>{" "}
      <span className="text-foreground">{fn.name}</span>
      <span className="text-muted-foreground">(</span>
      {fn.inputs.map((arg, index) => (
        <span key={arg.name}>
          {index > 0 ? <span className="text-muted-foreground">, </span> : null}
          {arg.name}
          <span className="text-muted-foreground">: </span>
          <span className="text-sky-700 dark:text-sky-400">{arg.type}</span>
        </span>
      ))}
      <span className="text-muted-foreground">)</span>
      {fn.outputs.length === 0 ? null : (
        <>
          <span className="text-muted-foreground"> -&gt; </span>
          {fn.outputs.map((type, index) => (
            <span key={index}>
              {index > 0 ? (
                <span className="text-muted-foreground">, </span>
              ) : null}
              <span className="text-sky-700 dark:text-sky-400">{type}</span>
            </span>
          ))}
        </>
      )}
    </span>
  );
}

function FunctionEntry({ fn }: { fn: ContractFunctionSpec }) {
  return (
    <div className="flex flex-col gap-1">
      <DocLines text={fn.doc} />
      <FunctionSignature fn={fn} />
    </div>
  );
}

function ErrorCaseLine({ errorCase }: { errorCase: ContractErrorCase }) {
  return (
    <div className="flex flex-col gap-1 ps-4">
      <DocLines text={errorCase.doc} />
      <span className="font-mono">
        {errorCase.name}
        <span className="text-muted-foreground">{` = ${errorCase.value},`}</span>
      </span>
    </div>
  );
}

function ErrorEnumBlock({ error }: { error: ContractErrorEnum }) {
  return (
    <div className="flex flex-col gap-1">
      <DocLines text={error.doc} />
      <p className="font-mono text-muted-foreground">#[contracterror]</p>
      <p className="font-mono">
        <span className="text-sky-700 dark:text-sky-400">enum</span>{" "}
        {error.name}
        <span className="text-muted-foreground"> {"{"}</span>
      </p>
      <div className="flex flex-col gap-3">
        {error.cases.map((errorCase) => (
          <ErrorCaseLine key={errorCase.name} errorCase={errorCase} />
        ))}
      </div>
      <p className="font-mono text-muted-foreground">{"}"}</p>
    </div>
  );
}

/**
 * The functions a contract exposes and the errors it can raise. A Stellar
 * Asset Contract has no wasm to read a spec from, so it gets a fixed
 * explanation of the interface it always implements rather than an empty
 * list pretending it has none.
 */
function Interface({
  executable,
  code,
}: {
  executable: ContractExecutable | undefined;
  code: UseQueryResult<ContractCodeDetails>;
}) {
  if (executable === undefined) {
    return (
      <p className="text-muted-foreground">
        This contract has no live instance to read an interface from.
      </p>
    );
  }
  if (executable.kind === "stellarAsset") {
    return (
      <p className="text-muted-foreground">
        This is a Stellar Asset Contract, the built-in wrapper Soroban gives
        every classic asset. It implements the standard SEP-41 token interface
        (transfer, balance, allowance, and so on) rather than custom code, so
        there is no spec to read here.
      </p>
    );
  }
  if (code.isPending) {
    return (
      <ul className="flex flex-col gap-2">
        {[0, 1, 2].map((index) => (
          <li key={index}>
            <ValueBar className="w-full max-w-[24rem]" />
          </li>
        ))}
      </ul>
    );
  }
  if (code.data?.interface === undefined) {
    return (
      <p className="text-muted-foreground">
        This contract's code has no readable interface section, or it could not
        be parsed.
      </p>
    );
  }
  const { functions, errors } = code.data.interface;
  return (
    <>
      <ol className="flex flex-col gap-4">
        {functions.map((fn) => (
          <li key={fn.name}>
            <FunctionEntry fn={fn} />
          </li>
        ))}
      </ol>
      {errors.length === 0 ? null : (
        <>
          <p className="pb-2 pt-5 font-medium text-foreground/80">Errors</p>
          <ol className="flex flex-col gap-5">
            {errors.map((error) => (
              <li key={error.name}>
                <ErrorEnumBlock error={error} />
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

function StorageEntry({
  entry,
}: {
  entry: { key: ScDisplay; value: ScDisplay };
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <code className="font-mono">
        <ScValView value={entry.key} />
      </code>
      <span className="text-muted-foreground">=</span>
      <code className="font-mono">
        <ScValView value={entry.value} />
      </code>
    </span>
  );
}

/**
 * The contract's own instance storage: the key/value data that lives
 * directly on its instance entry. This is not the whole of what a
 * contract keeps -- persistent and temporary entries under other keys
 * need those keys already known to look up, which nothing here can
 * discover on its own -- so that limit is said plainly rather than
 * implying this list is complete.
 */
function Storage({
  instance,
}: {
  instance: ContractInstanceDetails["instance"];
}) {
  if (instance === undefined) {
    return (
      <p className="text-muted-foreground">
        This contract has no live instance to read storage from.
      </p>
    );
  }
  return (
    <>
      <p className="pb-4 text-muted-foreground">
        This is the contract's own instance storage. A contract can keep other
        entries under keys of its own choosing, which cannot be listed without
        already knowing them.
      </p>
      {instance.storage.length === 0 ? (
        <p className="text-muted-foreground">
          This contract's instance carries no key/value storage of its own.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {instance.storage.map((entry, index) => (
            <li key={index}>
              <StorageEntry entry={entry} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/**
 * Transactions this contract's own events showed up in, read the same row
 * shape the account page's history uses. Not every call: a call that
 * raises no event of its own leaves nothing here, and nothing older than
 * the RPC provider's own retention window is reachable at all, so both
 * limits are said plainly rather than reading as a complete history.
 */
function Invocations({ contractId }: { contractId: string }) {
  const pages = useCursorPages();
  const top = useRef<HTMLDivElement>(null);
  const page = useQuery(
    contractInvocationsQuery(ACTIVE_NETWORK, contractId, pages.cursor),
  );

  if (page.isPending) {
    return (
      <div style={PAGED_TABLE}>
        <PagerSkeleton />
        <TableSkeleton
          columns={HISTORY_COLUMNS}
          minWidth={HISTORY_MIN_WIDTH}
          rows={4}
        />
      </div>
    );
  }
  if (page.isError) {
    return (
      <p className="text-muted-foreground">
        Could not load this contract's recent activity; the data providers are
        unreachable.
      </p>
    );
  }
  const retentionDays = Math.round(
    (page.data.window.toLedger - page.data.window.fromLedger) / LEDGERS_PER_DAY,
  );
  return (
    <div ref={top} style={PAGED_TABLE} className="scroll-mt-14">
      <p className="pb-4 text-muted-foreground">
        Transactions in which this contract raised one of its own events, as far
        back as this RPC provider retains (currently about {retentionDays}{" "}
        {retentionDays === 1 ? "day" : "days"}). A call that raises no event of
        its own leaves nothing here, even when the contract is invoked
        constantly.
      </p>
      {page.data.entries.length === 0 ? (
        <p className="text-muted-foreground">
          No such transactions in the provider's retention window. That can mean
          the contract was quiet for its entire history, or that it simply does
          not raise its own events.
        </p>
      ) : (
        <>
          <Pager
            pages={pages}
            records={page.data.rawEventCount}
            pageSize={EVENTS_PAGE}
            lastToken={page.data.nextCursor}
            onMove={() => top.current?.scrollIntoView({ block: "start" })}
          />
          <DataTable columns={HISTORY_COLUMNS} minWidth={HISTORY_MIN_WIDTH}>
            {page.data.entries.map((entry) => (
              <HistoryRow key={entry.hash} entry={entry} />
            ))}
          </DataTable>
        </>
      )}
    </div>
  );
}

const TAB_PLACEHOLDER_WIDTHS = ["w-16", "w-20", "w-20", "w-24"];

function DetailsSkeleton() {
  return (
    <dl>
      <Row label="Executable">
        <ValueBar className="w-64" />
      </Row>
      <Row label="Instance storage">
        <ValueBar className="w-24" />
      </Row>
      <Row label="Live until ledger">
        <ValueBar className="w-32" />
      </Row>
    </dl>
  );
}

function ListSkeleton() {
  return (
    <ul className="flex flex-col gap-2">
      {[0, 1, 2].map((index) => (
        <li key={index}>
          <ValueBar className="w-full max-w-[24rem]" />
        </li>
      ))}
    </ul>
  );
}

function ContractSkeleton({ tab }: { tab: string }) {
  return (
    <Tabs value={tab}>
      <TabsList className="h-auto gap-2 bg-transparent p-0">
        {TAB_PLACEHOLDER_WIDTHS.map((width, index) => (
          <TabsTrigger
            key={index}
            value={`skeleton-${index}`}
            className={TAB_PILL}
            disabled
          >
            <ValueBar className={width} />
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={tab} className="pt-5">
        {tab === "details" ? (
          <DetailsSkeleton />
        ) : tab === "invocations" ? (
          <div style={PAGED_TABLE}>
            <PagerSkeleton />
            <TableSkeleton
              columns={HISTORY_COLUMNS}
              minWidth={HISTORY_MIN_WIDTH}
              rows={4}
            />
          </div>
        ) : (
          <ListSkeleton />
        )}
      </TabsContent>
    </Tabs>
  );
}

export function ContractPage() {
  const { contractId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const target = classifySearch(contractId);
  const valid = target.type === "contract";

  const instance = useQuery({
    ...contractInstanceQuery(ACTIVE_NETWORK, target.value),
    enabled: valid,
  });
  const wasmHash =
    instance.data?.instance?.executable.kind === "wasm"
      ? instance.data.instance.executable.wasmHash
      : undefined;
  const code = useQuery({
    ...contractCodeQuery(ACTIVE_NETWORK, wasmHash ?? ""),
    enabled: wasmHash !== undefined,
  });

  if (!valid) {
    return <InvalidEntity expected="contract address" value={contractId} />;
  }

  const wanted = requestedTab(params);

  let body: ReactNode;
  if (instance.isPending) {
    body = <ContractSkeleton tab={wanted} />;
  } else if (instance.isSuccess) {
    body = (
      <Tabs
        value={wanted}
        onValueChange={(tab) => {
          const next = new URLSearchParams(params);
          if (tab === DEFAULT_TAB) {
            next.delete(TAB_PARAM);
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
          <TabsTrigger value="interface" className={TAB_PILL}>
            Interface
          </TabsTrigger>
          <TabsTrigger value="storage" className={TAB_PILL}>
            Storage
          </TabsTrigger>
          <TabsTrigger value="invocations" className={TAB_PILL}>
            Invocations
          </TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="pt-5">
          <Details data={instance.data} code={code} />
        </TabsContent>
        <TabsContent value="interface" className="pt-5">
          <Interface
            executable={instance.data.instance?.executable}
            code={code}
          />
        </TabsContent>
        <TabsContent value="storage" className="pt-5">
          <Storage instance={instance.data.instance} />
        </TabsContent>
        <TabsContent value="invocations" className="pt-5">
          <Invocations contractId={target.value} />
        </TabsContent>
      </Tabs>
    );
  } else {
    body = (
      <p className="text-muted-foreground">
        Could not load this contract; the data providers are unreachable.
      </p>
    );
  }

  return (
    <EntityShell
      title="Contract"
      identifier={<Address value={target.value} full />}
    >
      {body}
    </EntityShell>
  );
}
