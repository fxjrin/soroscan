import type { ClipboardEvent } from "react";
import { Link } from "react-router";
import { CopyButton } from "@/components/copy-button";
import { Identicon } from "@/components/identicon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { highlightAddress } from "@/lib/address-highlight";
import { sanitizeChainText, truncateMiddle } from "@/lib/format";
import { appPath } from "@/lib/network";
import { classifySearch, searchTargetPath } from "@/lib/search";
import { cn } from "@/lib/utils";

interface AddressProps {
  value: string;
  className?: string;
  full?: boolean;
}

/**
 * Middle-truncated address or hash in monospace. The full value stays
 * available to screen readers, to the copy button, and to manual
 * selection (copying the truncated text yields the full value).
 * Accounts get their SEP-33 identicon so the same entity is
 * recognizable across rows and across the ecosystem. Hovering reveals
 * the untruncated value and marks every other place the same entity
 * appears on the page.
 */
export function Address({ value, className, full = false }: AddressProps) {
  const clean = sanitizeChainText(value);
  const showIdenticon = /^[GCM]/.test(clean) && clean.length >= 56;

  function copyFullValue(event: ClipboardEvent) {
    event.preventDefault();
    event.clipboardData.setData("text/plain", clean);
  }

  const target = classifySearch(clean);
  const path =
    target.type === "account" || target.type === "contract"
      ? searchTargetPath(target)
      : null;
  const destination = path === null ? undefined : appPath(path);
  const label = (
    <bdi aria-hidden="true" className={full ? "break-all" : undefined}>
      {full ? clean : truncateMiddle(clean)}
    </bdi>
  );

  const body = (
    <span
      data-address={clean}
      onMouseEnter={() => highlightAddress(clean)}
      onMouseLeave={() => highlightAddress(null)}
      // baseline, not center: an inline-flex box with no baseline-aligned
      // item takes its baseline from the box bottom, which lifts the
      // address off the baseline of the text it sits in
      className={cn("inline-flex items-baseline gap-1.5 font-mono", className)}
    >
      {/* the square glyphs sit optically centered on the letters rather
          than on the baseline, where their bottom edge would leave them
          riding above the text */}
      {showIdenticon ? (
        <Identicon address={clean} className="self-center" />
      ) : null}
      <span onCopy={copyFullValue}>
        {/* an entity with a page of its own reads as a link and is
            coloured like one; a transaction hash rendered here is the
            page's own subject, so it stays plain text */}
        {destination ? (
          <Link
            to={destination}
            aria-label={clean}
            className="text-link transition-colors hover:text-link-hover"
          >
            {label}
          </Link>
        ) : (
          <span aria-label={clean}>{label}</span>
        )}
      </span>
      <CopyButton
        value={clean}
        label="Copy full value"
        className="self-center"
      />
    </span>
  );

  // an untruncated address is already all there, so it needs no tooltip
  if (full) {
    return body;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      {/* clear of the trigger: a tooltip touching the address would take
          the pointer off it and drop the highlight the moment it opens */}
      <TooltipContent
        sideOffset={6}
        className="max-w-[calc(100vw-2rem)] break-all font-mono text-sm"
      >
        {clean}
      </TooltipContent>
    </Tooltip>
  );
}
