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
import { tokenMove, type TokenMove } from "@/lib/token-move";
import {
  TreeElbow,
  TreeGuide,
  TREE_LINE,
  TREE_STEP,
} from "@/components/tree-lines";
import type { TraceCall, TraceEvent } from "@/lib/tx-trace";
import { cn } from "@/lib/utils";

interface TraceRow {
  key: string;
  depth: number;
  /** for each ancestor column, whether its branch continues below this row */
  guides: boolean[];
  lastSibling: boolean;
  kind: "call" | "event" | "move";
  /** who acted: the caller for a call, the emitter for an event */
  actor?: string;
  /** what a call ran against; an event acts on nothing */
  target?: string;
  signature: ReactNode;
}

/**
 * What a token event did to a balance, said in money rather than in raw
 * stroops, so the tree shows the value moving where it moved.
 */
function MoveLine({ move }: { move: TokenMove }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-mono">
        {move.amount}
        {move.code === undefined ? null : (
          <span className="text-muted-foreground"> {move.code}</span>
        )}
      </span>
      {move.from === undefined ? null : (
        <>
          <span className="text-muted-foreground">from</span>
          <Address value={move.from} />
        </>
      )}
      {move.to === undefined ? null : (
        <>
          <span className="text-muted-foreground">to</span>
          <Address value={move.to} />
        </>
      )}
    </span>
  );
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
  // a frame's events and its sub-calls happened in one order, so they are
  // put back into it before being drawn; keeping the two lists apart would
  // show a contract's events before work that ran before them
  const children = [
    ...call.events.map((event, index) => ({ event, index, seq: event.seq })),
    ...call.calls.map((sub, index) => ({ call: sub, index, seq: sub.seq })),
  ].sort((left, right) => left.seq - right.seq);

  children.forEach((child, position) => {
    const last = position === children.length - 1;
    if ("event" in child) {
      const move = tokenMove(child.event);
      rows.push({
        key: `${key}-event-${child.index}`,
        depth: depth + 1,
        guides: childGuides,
        // a movement is the event's child, not its sibling, so it does not
        // make the event carry a line on to a sibling that is not there
        lastSibling: last,
        kind: "event",
        actor: child.event.contract ?? call.contract,
        signature: <EventSignature event={child.event} />,
      });
      if (move !== undefined) {
        rows.push({
          key: `${key}-move-${child.index}`,
          depth: depth + 2,
          guides: last ? childGuides : [...childGuides, true],
          lastSibling: true,
          kind: "move",
          signature: <MoveLine move={move} />,
        });
      }
      return;
    }
    // whatever a contract calls next, it is the one calling
    rows.push(
      ...flattenCall(
        child.call,
        call.contract,
        childGuides,
        last,
        depth + 1,
        `${key}.${child.index}`,
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

function lineStart(level: number) {
  return CELL_PADDING + TREE_LINE + level * TREE_STEP;
}

function Connectors({ row }: { row: TraceRow }) {
  return (
    <>
      {row.guides.map((continues, level) =>
        continues ? <TreeGuide key={level} start={lineStart(level)} /> : null,
      )}
      {row.depth > 0 ? (
        <TreeElbow start={lineStart(row.depth - 1)} last={row.lastSibling} />
      ) : null}
    </>
  );
}

/**
 * Says that a tree came from the signed authorization data rather than from
 * the execution itself, which is what is left once the meta has aged out of
 * RPC retention.
 */
export function AuthTraceNote() {
  return (
    <p className="pb-3 text-muted-foreground">
      Reconstructed from the transaction's signed authorization data: only
      sub-calls that required authorization appear, and return values are
      unknown.
    </p>
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
  continuation = false,
}: {
  calls: TraceCall[];
  /** the account that submitted the transaction, so the first call has a caller */
  invoker?: string;
  /**
   * the row above already showed the call this tree is of, so the tree
   * picks up from what that call did rather than repeating it
   */
  continuation?: boolean;
}) {
  const rows = flatten(calls, invoker).filter(
    (row) => !continuation || row.depth > 0,
  );
  // a continuation only has rows to draw when the call above it went on to
  // call something else or raise an event; a leaf call has neither, and the
  // caller decides what, if anything, stands in for the tree here
  if (rows.length === 0) {
    return null;
  }
  return (
    <DataTable minWidth={MIN_WIDTH} columns={COLUMNS} headless={continuation}>
      {rows.map((row) => (
        <DataRow key={row.key} divided={false}>
          <DataCell className="relative py-2">
            <Connectors row={row} />
            <span
              className="block"
              // depth is data, so the indent is computed rather than
              // enumerated as a class per level
              style={{ paddingInlineStart: row.depth * TREE_STEP }}
            >
              {row.actor ? <Address value={row.actor} /> : null}
              {row.kind === "move" ? null : (
                <span
                  className={cn(
                    "me-2 text-muted-foreground",
                    row.actor ? "ms-2" : undefined,
                  )}
                >
                  {row.kind === "event" ? "event" : "call"}
                </span>
              )}
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
