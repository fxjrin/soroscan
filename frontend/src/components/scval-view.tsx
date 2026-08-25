import { ArrowRight } from "lucide-react";
import { Fragment } from "react";
import { Address } from "@/components/address";
import { sanitizeChainText } from "@/lib/format";
import type { ScDisplay } from "@/lib/scval";
import { cn } from "@/lib/utils";

// only the types whose value alone is ambiguous get a suffix; strings
// carry quotes and booleans read unambiguously without one. A bare
// symbol looks exactly like a string, so it keeps its tag
const TAGGED_TYPES = new Set([
  "u32",
  "i32",
  "u64",
  "i64",
  "u128",
  "i128",
  "u256",
  "i256",
  "time",
  "dur",
  "bytes",
  "sym",
  "nonce",
]);

/**
 * Structural punctuation, dimmed so it frames the values instead of
 * competing with them. Monospace brackets are drawn from descender to
 * above cap height, so at an equal size they carry far more visual
 * weight than the digits they enclose; the color makes up the balance.
 */
function Punctuation({ children }: { children: string }) {
  return <span className="text-muted-foreground">{children}</span>;
}

/**
 * A contract call or event as one code expression: the name, its
 * arguments, then an arrow to the value it returned. Calls get the
 * contract accent, events the transfer accent; an undecodable argument
 * renders as a muted question mark.
 */
export function CallSignature({
  name,
  args,
  result,
  variant = "call",
  standalone = false,
}: {
  name: string;
  args: Array<ScDisplay | undefined>;
  result?: ScDisplay;
  variant?: "call" | "event";
  /** the call is the whole value, not a phrase inside a sentence */
  standalone?: boolean;
}) {
  return (
    // the tint marks where the sentence stops and the literal call begins.
    // In a sentence it clones across line boxes so every line keeps its
    // padding; on its own it is one box, so wrapped lines share a left edge
    <code
      className={cn(
        "rounded-sm bg-muted px-1.5 py-0.5 font-mono",
        standalone
          ? "inline-block max-w-full align-top"
          : "box-decoration-clone",
      )}
    >
      {/* a call name is not a destination, so it stays in the plain text
          colour; only an event keeps an accent, and green cannot be read
          as a link */}
      <span
        className={
          variant === "event"
            ? "font-medium text-emerald-700 dark:text-emerald-400"
            : "font-medium"
        }
      >
        {name}
      </span>
      <Punctuation>{"("}</Punctuation>
      {args.map((arg, index) => (
        <Fragment key={index}>
          {index > 0 ? <Punctuation>{", "}</Punctuation> : null}
          {arg ? (
            <ScValView value={arg} />
          ) : (
            <span className="text-muted-foreground">?</span>
          )}
        </Fragment>
      ))}
      <Punctuation>{")"}</Punctuation>
      {result ? (
        <>
          {/* an icon rather than a glyph: the codebase is ASCII only, and
              a two-character ascii arrow reads as two marks at this size */}
          <ArrowRight
            className="mx-1 inline-block size-3.5 align-[-0.15em] text-muted-foreground"
            role="img"
            aria-label="returns"
          />
          <ScValView value={result} />
        </>
      ) : null}
    </code>
  );
}

/** One decoded ScVal, rendered inline so containers wrap naturally. */
export function ScValView({ value }: { value: ScDisplay }) {
  switch (value.kind) {
    case "address":
      return <Address value={value.address} />;
    case "vec":
      return (
        <span>
          <Punctuation>{"["}</Punctuation>
          {value.items.map((item, index) => (
            <Fragment key={index}>
              {index > 0 ? <Punctuation>{", "}</Punctuation> : null}
              <ScValView value={item} />
            </Fragment>
          ))}
          <Punctuation>{"]"}</Punctuation>
        </span>
      );
    case "map":
      return (
        <span>
          <Punctuation>{"{ "}</Punctuation>
          {value.entries.map((entry, index) => (
            <Fragment key={index}>
              {index > 0 ? <Punctuation>{", "}</Punctuation> : null}
              <ScValView value={entry.key} />
              <Punctuation>{": "}</Punctuation>
              <ScValView value={entry.value} />
            </Fragment>
          ))}
          <Punctuation>{" }"}</Punctuation>
        </span>
      );
    case "opaque":
      return <span className="text-muted-foreground">{value.type}</span>;
    default: {
      if (value.type === "str") {
        return <span>{`"${sanitizeChainText(value.text)}"`}</span>;
      }
      return (
        <span>
          {sanitizeChainText(value.text)}
          {TAGGED_TYPES.has(value.type) ? (
            <span className="ms-0.5 align-sub text-xs text-muted-foreground">
              {value.type}
            </span>
          ) : null}
        </span>
      );
    }
  }
}
