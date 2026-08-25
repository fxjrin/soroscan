// strkeys and hashes are alphanumeric, so anything else never reaches a
// selector: chain data cannot break out of the query it is spliced into
const HIGHLIGHTABLE = /^[A-Za-z0-9]+$/;

export function canHighlight(value: string): boolean {
  return HIGHLIGHTABLE.test(value);
}

/**
 * Marks every occurrence of one address on the page so a reader can see
 * where else the same account or contract takes part. The mark is a data
 * attribute React never writes, so a re-render cannot clear it, and it
 * carries no meaning for assistive technology: the full value already
 * reaches screen readers through each address's own label.
 */
export function highlightAddress(value: string | null): void {
  for (const marked of document.querySelectorAll(
    "[data-address][data-match]",
  )) {
    marked.removeAttribute("data-match");
  }
  if (value === null || !canHighlight(value)) {
    return;
  }
  for (const match of document.querySelectorAll(`[data-address="${value}"]`)) {
    match.setAttribute("data-match", "");
  }
}
