import type { ReactNode } from "react";
import { Address } from "@/components/address";
import {
  DataCell,
  DataRow,
  DataTable,
  TableSkeleton,
  type Column,
} from "@/components/data-table";
import { CallSignature } from "@/components/scval-view";
import type { TraceCall, TraceEvent } from "@/lib/tx-trace";
import { cn } from "@/lib/utils";

interface TraceRow {
  key: string;
  depth: number;
  /** for each ancestor column, whether its branch continues below this row */
  guides: boolean[];
  lastSibling: boolean;
  kind: "call" | "event";
  /** who acted: the caller for a call, the emitter for an event */
  actor?: string;
  /** what a call ran against; an event acts on nothing */
  target?: string;
  signature: ReactNode;
}

/** An event as the same code expression a call uses, in the event accent. */
export function EventSignature({ event }: { event: TraceEvent }) {
  const [first, ...rest] = event.topics;
  const named = first?.kind === "text" && first.type === "sym";
  return (
    <CallSignature
      variant="event"
      name={named ? first.text : "raised"}
      args={named ? rest : event.topics}
      result={event.data}
    />
  );
}

// the tree is flattened into rows so it can share the tabular surface the
// rest of the page uses, and the nesting is redrawn with connector lines
// instead of by indenting whole blocks
function flattenCall(
  call: TraceCall,
  caller: string | undefined,
  guides: boolean[],
  lastSibling: boolean,
  depth: number,
  key: string,
): TraceRow[] {
  const rows: TraceRow[] = [
    {
      key,
      depth,
      guides,
      lastSibling,
      kind: "call",
      actor: caller,
      target: call.contract,
      signature: (
        <CallSignature name={call.fn} args={call.args} result={call.result} />
      ),
    },
  ];
  // a root occupies no column of its own, so it contributes no guide line
  const childGuides = depth === 0 ? [] : [...guides, !lastSibling];
  const total = call.events.length + call.calls.length;
  call.events.forEach((event, index) => {
    rows.push({
      key: `${key}-event-${index}`,
      depth: depth + 1,
      guides: childGuides,
      lastSibling: index === total - 1,
      kind: "event",
      actor: event.contract ?? call.contract,
      signature: <EventSignature event={event} />,
    });
  });
  // whatever a contract calls next, it is the one calling
  call.calls.forEach((sub, index) => {
    rows.push(
      ...flattenCall(
        sub,
        call.contract,
        childGuides,
        call.events.length + index === total - 1,
        depth + 1,
        `${key}.${index}`,
      ),
    );
  });
  return rows;
}

function flatten(calls: TraceCall[], invoker?: string): TraceRow[] {
  return calls.flatMap((call, index) =>
    flattenCall(
      call,
      invoker,
      [],
      index === calls.length - 1,
      0,
      String(index),
    ),
  );
}

const COLUMNS: Column[] = [{ label: "Function call" }];
const MIN_WIDTH = "min-w-[34rem]";

/** The tree's table while the transaction meta is still being fetched. */
export function CallTreeSkeleton() {
  return <TableSkeleton columns={COLUMNS} minWidth={MIN_WIDTH} rows={3} />;
}

const CELL_PADDING = 12; // matches the shared cell's inline padding
const STEP = 24; // horizontal room one level of nesting takes
const LINE = 8; // where a connector sits inside its own level
const STUB = 10; // how far the elbow reaches toward the label

// the elbow points at the row's first line rather than at the middle of
// the row, so a signature that wraps to two lines does not drag the
// connector down into the gap between them
const FIRST_LINE = "calc(0.5rem + 0.5lh)";

function lineStart(level: number) {
  return CELL_PADDING + LINE + level * STEP;
}

// the connectors are positioned against the cell rather than its contents,
// so they run the full height of the row and meet the row below without a
// break, whatever makes one row taller than another
function Connectors({ row }: { row: TraceRow }) {
  return (
    <>
      {row.guides.map((continues, level) =>
        continues ? (
          <span
            key={level}
            className="absolute inset-y-0 w-px bg-border"
            style={{ insetInlineStart: lineStart(level) }}
          />
        ) : null,
      )}
      {row.depth > 0 ? (
        <>
          <span
            className={cn(
              "absolute top-0 w-px bg-border",
              !row.lastSibling && "bottom-0",
            )}
            style={{
              insetInlineStart: lineStart(row.depth - 1),
              height: row.lastSibling ? FIRST_LINE : undefined,
            }}
          />
          <span
            className="absolute h-px bg-border"
            style={{
              insetInlineStart: lineStart(row.depth - 1),
              top: FIRST_LINE,
              width: STUB,
            }}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * A contract call and everything it set off, read as a sentence: who acted,
 * what they did, against which contract, and with what. The line flows as
 * text rather than as boxes, so a long argument list wraps inside itself
 * instead of pushing the function name onto a line of its own.
 */
export function CallTree({
  calls,
  invoker,
}: {
  calls: TraceCall[];
  /** the account that submitted the transaction, so the first call has a caller */
  invoker?: string;
}) {
  return (
    <DataTable minWidth={MIN_WIDTH} columns={COLUMNS}>
      {flatten(calls, invoker).map((row) => (
        <DataRow key={row.key} divided={false}>
          <DataCell className="relative py-2">
            <Connectors row={row} />
            <span
              className="block"
              // depth is data, so the indent is computed rather than
              // enumerated as a class per level
              style={{ paddingInlineStart: row.depth * STEP }}
            >
              {row.actor ? <Address value={row.actor} /> : null}
              <span className="mx-2 text-muted-foreground">
                {row.kind === "event" ? "event" : "call"}
              </span>
              {row.target ? <Address value={row.target} /> : null}
              {/* the tint carries its own padding, so the gap before it is
                  narrower than the one between two bare words */}
              <span className={row.target ? "ms-1.5" : undefined}>
                {row.signature}
              </span>
            </span>
          </DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
}
