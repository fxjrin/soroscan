import { cn } from "@/lib/utils";

/** Horizontal room one level of nesting takes. */
export const TREE_STEP = 24;

/**
 * Where a connector's centre sits inside its own level: half an identicon,
 * so the line drops out of the middle of the address it belongs to.
 */
export const TREE_LINE = 7;

// a hairline is one pixel wide, so its box starts half a pixel before the
// centre it is meant to sit on
function stem(centre: number) {
  return centre - 0.5;
}

// how far the elbow reaches toward the label
const STUB = 10;

// the elbow points at the row's first line rather than at the middle of the
// row, so a label that wraps to two lines does not drag the connector down
// into the gap between them. It assumes the row's own py-2
const FIRST_LINE = "calc(0.5rem + 0.5lh)";

/**
 * The line an ancestor draws through a row, saying its branch continues
 * below. Positioned against the row box rather than its contents, so it
 * runs the full height and meets the row below without a break.
 */
export function TreeGuide({ start }: { start: number }) {
  return (
    <span
      className="absolute inset-y-0 w-px bg-border"
      style={{ insetInlineStart: stem(start) }}
    />
  );
}

/**
 * The corner that ties a row to its parent: down from the row above, then
 * across to the label. The last child stops at its own first line instead
 * of carrying the line on to a sibling that is not there.
 */
export function TreeElbow({ start, last }: { start: number; last: boolean }) {
  return (
    <>
      <span
        className={cn("absolute top-0 w-px bg-border", !last && "bottom-0")}
        style={{
          insetInlineStart: stem(start),
          height: last ? FIRST_LINE : undefined,
        }}
      />
      <span
        className="absolute h-px bg-border"
        style={{ insetInlineStart: stem(start), top: FIRST_LINE, width: STUB }}
      />
    </>
  );
}
