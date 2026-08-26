import type { OperationRecord } from "@/lib/horizon/client";

/** The operations of one transaction, in the order Horizon returned them. */
export interface HistoryEntry {
  hash: string;
  /** the paging token of the last operation in the group, for the next page */
  lastToken: string;
  operations: OperationRecord[];
}

/**
 * Groups an account's operations by the transaction they came from. Horizon
 * returns operations newest first, and a transaction's operations are
 * adjacent in that order, so a run of the same hash is one transaction. A
 * transaction can still straddle a page boundary: the tail of it opens the
 * next page as its own entry, which is the honest thing to show, since the
 * page really does start in the middle of it.
 */
export function groupByTransaction(records: OperationRecord[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const record of records) {
    const current = entries[entries.length - 1];
    if (current !== undefined && current.hash === record.transaction_hash) {
      current.operations.push(record);
      current.lastToken = record.paging_token;
      continue;
    }
    entries.push({
      hash: record.transaction_hash,
      lastToken: record.paging_token,
      operations: [record],
    });
  }
  return entries;
}
