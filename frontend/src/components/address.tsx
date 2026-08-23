import type { ClipboardEvent } from "react";
import { CopyButton } from "@/components/copy-button";
import { sanitizeChainText, truncateMiddle } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AddressProps {
  value: string;
  className?: string;
}

/**
 * Middle-truncated address or hash in monospace. The full value stays
 * available to screen readers, to the copy button, and to manual
 * selection (copying the truncated text yields the full value).
 */
export function Address({ value, className }: AddressProps) {
  const clean = sanitizeChainText(value);

  function copyFullValue(event: ClipboardEvent) {
    event.preventDefault();
    event.clipboardData.setData("text/plain", clean);
  }

  return (
    <span className={cn("inline-flex items-center gap-1 font-mono", className)}>
      <span aria-label={clean} onCopy={copyFullValue}>
        <bdi aria-hidden="true">{truncateMiddle(clean)}</bdi>
      </span>
      <CopyButton value={clean} label="Copy full value" />
    </span>
  );
}
