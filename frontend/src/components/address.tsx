import type { ClipboardEvent } from "react";
import { CopyButton } from "@/components/copy-button";
import { Identicon } from "@/components/identicon";
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
 * Accounts get their SEP-33 identicon so the same entity is
 * recognizable across rows and across the ecosystem.
 */
export function Address({ value, className }: AddressProps) {
  const clean = sanitizeChainText(value);
  const showIdenticon = /^[GCM]/.test(clean) && clean.length >= 56;

  function copyFullValue(event: ClipboardEvent) {
    event.preventDefault();
    event.clipboardData.setData("text/plain", clean);
  }

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 font-mono", className)}
    >
      {showIdenticon ? <Identicon address={clean} /> : null}
      <span aria-label={clean} onCopy={copyFullValue}>
        <bdi aria-hidden="true">{truncateMiddle(clean)}</bdi>
      </span>
      <CopyButton value={clean} label="Copy full value" />
    </span>
  );
}
