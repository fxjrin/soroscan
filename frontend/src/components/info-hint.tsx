import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Etherscan-style inline explainer for labels and metrics. */
export function InfoHint({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="What is this?"
          // the tap target is an overlay so the padding cannot make the
          // label taller than the value it sits beside
          className="relative inline-flex text-muted-foreground transition-colors after:absolute after:-inset-[5px] after:content-[''] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-sm">{children}</TooltipContent>
    </Tooltip>
  );
}
