import {
  ArrowDownUp,
  ArrowRightLeft,
  CircleCheck,
  CircleX,
  FileCodeCorner,
  Settings2,
} from "lucide-react";
import type { OpFamily } from "@/lib/activity";
import { cn } from "@/lib/utils";

function familyIcon(family: OpFamily) {
  switch (family) {
    case "dex":
      return <ArrowDownUp className="size-4 shrink-0" aria-hidden="true" />;
    case "config":
      return <Settings2 className="size-4 shrink-0" aria-hidden="true" />;
    default:
      return <ArrowRightLeft className="size-4 shrink-0" aria-hidden="true" />;
  }
}

// a badge is a token of its own, not a mark inside a sentence, so it gets
// real room: a fixed 24px box with the content centred, which also evens
// out the space the font leaves above the caps and below the baseline.
//
// The two sides carry different padding so the ink lands the same
// distance from both edges: an icon already holds 1.33px of its own
// whitespace at this size and a letter about 0.3px, so each side is the
// 7.3px target minus what its content brings.
const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-sm ps-1.5 pe-[7px]";

const TAG_STYLES: Record<OpFamily, string> = {
  transfer: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  contract: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  dex: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  config: "bg-muted text-muted-foreground",
  other: "bg-muted text-muted-foreground",
};

export function OpTag({
  family,
  children,
}: {
  family: OpFamily;
  children: React.ReactNode;
}) {
  return (
    <span className={cn(CHIP, "shrink-0 font-medium", TAG_STYLES[family])}>
      {familyIcon(family)}
      {children}
    </span>
  );
}

/** The contract function a call invoked, rendered as its own code chip. */
export function FunctionChip({ name }: { name: string }) {
  return (
    // monospace pads every glyph to a fixed advance, so its trailing
    // whitespace is wider than the sans stack's and the padding gives
    // that much back
    <span
      className={cn(
        CHIP,
        "min-w-0 bg-muted pe-1.5 font-mono text-foreground/80",
      )}
    >
      <FileCodeCorner className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Transaction outcome, sized to sit beside an OpTag. */
export function StatusChip({ successful }: { successful: boolean }) {
  return (
    <span
      className={cn(
        CHIP,
        "shrink-0 font-medium",
        successful
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-red-500/10 text-red-600 dark:text-red-400",
      )}
    >
      {successful ? (
        <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <CircleX className="size-4 shrink-0" aria-hidden="true" />
      )}
      {successful ? "succeeded" : "failed"}
    </span>
  );
}
