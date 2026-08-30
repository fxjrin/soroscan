import type { CSSProperties } from "react";
import type { Column } from "@/components/data-table";

// the header comes to rest under the pager: the site header plus the row
// of controls above it
export const PAGED_TABLE = { "--table-sticky-top": "6.75rem" } as CSSProperties;

export const HISTORY_COLUMNS: Column[] = [
  { label: "Type", tight: true },
  { label: "Transaction" },
  { label: "Fee", numeric: true, tight: true },
  { label: "Age", numeric: true, tight: true },
];

export const HISTORY_MIN_WIDTH = "min-w-[44rem]";
