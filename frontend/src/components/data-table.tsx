import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface Column {
  label: string;
  /** right-aligned, for amounts and other figures read from their end */
  numeric?: boolean;
  /** shrink to the content, so a short column leaves no gap beside it */
  tight?: boolean;
}

/**
 * The one tabular surface the transaction tabs share: a header band with
 * rounded top corners, rows that separate with a rule, and a hover that
 * bleeds past the text column so the row reads as one target. Every table
 * goes through here so none of them can drift from the others.
 */
export function DataTable({
  columns,
  minWidth,
  children,
}: {
  columns: Column[];
  minWidth: string;
  children: ReactNode;
}) {
  const last = columns.length - 1;
  return (
    <div className="-mx-3 overflow-x-auto">
      <table
        className={cn(
          "w-full border-separate border-spacing-0 text-left",
          minWidth,
        )}
      >
        <thead>
          <tr className="bg-muted text-muted-foreground">
            {columns.map((column, index) => (
              <th
                key={column.label}
                scope="col"
                className={cn(
                  "px-3 py-2 font-normal",
                  index === 0 && "rounded-ss-md",
                  index === last && "rounded-se-md",
                  column.numeric && "text-right",
                  column.tight && "w-px whitespace-nowrap",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function DataRow({
  children,
  // rows of a tree belong to one another, so a rule between them would
  // cut apart what the connectors are drawing together
  divided = true,
}: {
  children: ReactNode;
  divided?: boolean;
}) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-muted/40",
        divided &&
          "last:[&>td]:border-b-0 [&>td]:border-b [&>td]:border-border/50",
      )}
    >
      {children}
    </tr>
  );
}

export function DataCell({
  numeric,
  tight,
  className,
  children,
}: {
  numeric?: boolean;
  tight?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <td
      className={cn(
        "px-3 py-3",
        numeric && "text-right",
        tight && "w-px whitespace-nowrap",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Stands in for a value the chain did not record for this row. */
export function NoValue() {
  return <span className="text-muted-foreground/50">-</span>;
}

const CELL_WIDTHS = ["w-28", "w-20", "w-36", "w-24", "w-32"];

/**
 * The same table while its rows load: real headers, so the reader already
 * knows what is coming, over placeholder cells of the right height.
 */
export function TableSkeleton({
  columns,
  minWidth,
  rows = 5,
}: {
  columns: Column[];
  minWidth: string;
  rows?: number;
}) {
  return (
    <DataTable columns={columns} minWidth={minWidth}>
      {Array.from({ length: rows }, (_, row) => (
        <DataRow key={row}>
          {columns.map((column, index) => (
            <DataCell
              key={column.label}
              numeric={column.numeric}
              tight={column.tight}
            >
              <Skeleton
                className={cn(
                  "h-5 max-w-full",
                  CELL_WIDTHS[(row + index) % CELL_WIDTHS.length],
                  column.numeric && "ms-auto",
                )}
              />
            </DataCell>
          ))}
        </DataRow>
      ))}
    </DataTable>
  );
}
