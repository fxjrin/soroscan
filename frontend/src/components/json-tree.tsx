import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { sanitizeChainText } from "@/lib/format";
import { cn } from "@/lib/utils";

// decoded XDR nests deeply but not without bound; anything past this is a
// malformed blob rather than a real transaction
const MAX_DEPTH = 16;

const PUNCTUATION = "text-muted-foreground";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// keeps every key at one level on the same x whether or not its value can
// be folded
function Gutter() {
  return <span className="me-1 inline-block size-3.5" aria-hidden="true" />;
}

function Key({ name }: { name?: string }) {
  if (name === undefined) {
    return null;
  }
  return (
    <>
      <span className="text-sky-700 dark:text-sky-300">{`"${name}"`}</span>
      <span className={PUNCTUATION}>: </span>
    </>
  );
}

function Leaf({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-violet-700 dark:text-violet-400">null</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className="text-violet-700 dark:text-violet-400">
        {String(value)}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="text-amber-700 dark:text-amber-400">{value}</span>;
  }
  return (
    <bdi className="break-all text-emerald-700 dark:text-emerald-400">
      {`"${sanitizeChainText(String(value))}"`}
    </bdi>
  );
}

// how deep each placeholder line sits, so the shape reads as a tree rather
// than as a stack of bars
const SKELETON_LINES = [0, 1, 2, 2, 1, 2, 3, 2, 1, 0];

/** The tree's shape while the XDR chunk and the decode are still loading. */
export function JsonTreeSkeleton() {
  return (
    <div className="flex flex-col gap-1" aria-hidden="true">
      {SKELETON_LINES.map((depth, index) => (
        <div key={index} style={{ paddingInlineStart: depth * 14 }}>
          <Skeleton
            className="h-3.5"
            style={{ width: `${9 - depth * 1.5 + (index % 3)}rem` }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * A decoded XDR value printed as JSON: keys, values, and punctuation each
 * carry their own colour, and every object or array is a disclosure the
 * reader can fold away. Strings are chain data, so they go through the
 * same sanitiser as the rest of the app before reaching the DOM.
 */
export function JsonTree({
  value,
  name,
  last = true,
  depth = 0,
}: {
  value: unknown;
  name?: string;
  last?: boolean;
  depth?: number;
}) {
  const comma = last ? null : <span className={PUNCTUATION}>,</span>;
  const branch = Array.isArray(value) || isRecord(value);

  if (!branch || depth > MAX_DEPTH) {
    return (
      <div className="whitespace-pre-wrap">
        <Gutter />
        <Key name={name} />
        {depth > MAX_DEPTH ? (
          <span className={PUNCTUATION}>...</span>
        ) : (
          <Leaf value={value} />
        )}
        {comma}
      </div>
    );
  }

  const entries: Array<[string | undefined, unknown]> = Array.isArray(value)
    ? value.map((item) => [undefined, item])
    : Object.entries(value);
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];

  if (entries.length === 0) {
    return (
      <div>
        <Gutter />
        <Key name={name} />
        <span className={PUNCTUATION}>{open + close}</span>
        {comma}
      </div>
    );
  }

  return (
    <details className="json-branch group" open>
      <summary className="cursor-pointer list-none">
        <ChevronRight
          className="me-1 inline-block size-3.5 align-[-0.2em] text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        <Key name={name} />
        <span className={PUNCTUATION}>{open}</span>
        <span
          className={cn(PUNCTUATION, "json-folded")}
        >{` ... ${close}`}</span>
      </summary>
      <div className="ms-1.5 border-s border-border/50 ps-3">
        {entries.map(([key, child], index) => (
          <JsonTree
            key={key ?? index}
            name={key}
            value={child}
            last={index === entries.length - 1}
            depth={depth + 1}
          />
        ))}
      </div>
      <div>
        <Gutter />
        <span className={PUNCTUATION}>{close}</span>
        {comma}
      </div>
    </details>
  );
}
