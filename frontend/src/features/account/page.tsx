import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UntrustedText } from "@/components/untrusted-text";
import { EntityShell, Row, ValueBar } from "@/features/entity-shell";
import { InvalidEntity } from "@/features/invalid-entity";
import { HistoryRow, Pager, PagerSkeleton } from "@/features/history-table";
import {
  HISTORY_COLUMNS,
  HISTORY_MIN_WIDTH,
  PAGED_TABLE,
} from "@/features/history-table-layout";
import { enabledFlags, sortedBalances, xlmBreakdown } from "@/lib/account";
import { assetCodeOf } from "@/lib/activity";
import { formatAgo, formatDecimalDisplay } from "@/lib/format";
import {
  NotFoundError,
  type AccountRecord,
  type BalanceRecord,
  type OfferAsset,
} from "@/lib/horizon/client";
import { ACTIVE_NETWORK } from "@/lib/network";
import {
  accountOffersQuery,
  accountOperationsQuery,
  accountQuery,
} from "@/lib/queries";
import { resolveMuxed, type MuxedAddress } from "@/lib/muxed";
import { classifySearch } from "@/lib/search";
import { groupByTransaction } from "@/lib/history";
import { useCursorPages } from "@/lib/use-cursor-pages";
import { useNow } from "@/lib/use-now";

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
        <AssetIcon code={code} issuer={asset.asset_issuer} />
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
        pageSize={HISTORY_PAGE}
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
            <AssetIcon code={code} issuer={balance.asset_issuer} />
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
        pageSize={HISTORY_PAGE}
        lastToken={entries[entries.length - 1]?.lastToken}
        onMove={() => top.current?.scrollIntoView({ block: "start" })}
      />
      <div className="rows-in">
        <DataTable columns={HISTORY_COLUMNS} minWidth={HISTORY_MIN_WIDTH}>
          {entries.map((entry) => (
            <HistoryRow key={entry.hash + entry.lastToken} entry={entry} />
          ))}
        </DataTable>
      </div>
    </div>
  );
}

const TAB_PLACEHOLDER_WIDTHS = ["w-12", "w-16", "w-14"];

// the pager holds the same band while it loads, so the table header below
// it does not move once the rows arrive
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
