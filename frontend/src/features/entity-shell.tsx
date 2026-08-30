import type { ReactNode } from "react";
import { InfoHint } from "@/components/info-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface EntityShellProps {
  title: string;
  identifier?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
}

export function EntityShell({
  title,
  identifier,
  summary,
  children,
}: EntityShellProps) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-medium tracking-tight">{title}</h1>
      {/* the identifier and the summary occupy the same slot on a page that
          swaps one for the other, so they sit at the same distance */}
      {identifier ? <div className="mt-3">{identifier}</div> : null}
      {summary ? <div className="mt-3">{summary}</div> : null}
      <div className="reveal-in mt-8">{children}</div>
    </main>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-y-1 py-2.5 sm:grid-cols-[13.5rem_minmax(0,1fr)] sm:gap-x-8">
      {/* self-start keeps the label on the first line of a value that wraps,
          while items-center still centres the hint icon against the label */}
      <dt className="flex items-center gap-2 self-start font-medium text-foreground/80">
        {hint ? (
          <InfoHint>{hint}</InfoHint>
        ) : (
          // matches the hint icon's box so every label starts at the same
          // x whether or not the row explains itself
          <span className="w-3.5 shrink-0" aria-hidden="true" />
        )}
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Stands in for one Row value while it loads. It sits inside a line box of
 * the row's own height, so a page of placeholders is exactly as tall as the
 * page of text that replaces it and nothing shifts on arrival.
 */
export function ValueBar({ className }: { className?: string }) {
  return (
    <span className="flex h-[1lh] items-center">
      <Skeleton className={cn("h-5", className)} />
    </span>
  );
}
