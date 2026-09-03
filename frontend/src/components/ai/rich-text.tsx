import type { ReactNode } from "react";
import { Link } from "react-router";
import { Address } from "@/components/address";
import { AssetIcon } from "@/components/asset-icon";
import { ClockGlyph } from "@/components/ai/icons";
import type { AiAsset } from "@/lib/ai/client";
import { assetPath } from "@/lib/asset-meta";
import {
  formatAgo,
  formatTimestamp,
  sanitizeChainText,
  truncateMiddle,
} from "@/lib/format";
import { appPath } from "@/lib/network";
import { classifySearch } from "@/lib/search";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

// Stellar strkeys (account G / muxed M / contract C) and 64-hex tx hashes are
// the only unambiguous ids in prose; bare numbers are left alone so a fee or a
// count is never mistaken for a ledger link.
const ID_PART = "[GCM][A-Z2-7]{55,68}|[0-9a-fA-F]{64}";
// ISO-8601 UTC instants the model quotes for ledger close times; rendered as a
// readable date plus a live relative age
const TIME_PART = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z";

function IdToken({ value }: { value: string }) {
  const target = classifySearch(value);
  if (target.type === "account" || target.type === "contract") {
    return <Address value={value} />;
  }
  if (target.type === "tx") {
    return (
      <Link
        to={appPath(`/tx/${target.value}`)}
        title={target.value}
        className="font-mono text-link transition-colors hover:text-link-hover"
      >
        {truncateMiddle(target.value)}
      </Link>
    );
  }
  return <span className="font-mono break-all">{value}</span>;
}

function TimeToken({ iso }: { iso: string }) {
  const now = useNow();
  return (
    <span className="inline-flex items-baseline gap-1.5" title={iso}>
      <ClockGlyph className="size-3.5 shrink-0 self-center text-muted-foreground" />
      <span>{formatTimestamp(iso)}</span>
      <span className="text-muted-foreground">{formatAgo(iso, now)}</span>
    </span>
  );
}

function AssetToken({ code, issuer }: { code: string; issuer?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <AssetIcon
        code={code}
        issuer={issuer}
        size={18}
        className="self-center"
      />
      <Link
        to={assetPath(code, issuer)}
        className="text-link transition-colors hover:text-link-hover"
      >
        {code}
      </Link>
    </span>
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// one pass over the text: ids first, then any known asset code (whole word,
// case-sensitive) becomes an inline logo. Codes come only from the answer's
// own assets list, so a short code cannot match an unrelated word.
function render(
  text: string,
  assets: Map<string, string | undefined>,
): ReactNode[] {
  const clean = sanitizeChainText(text);
  const codes = [...assets.keys()].sort((a, b) => b.length - a.length);
  const assetPart = codes.length
    ? `\\b(?:${codes.map(escapeRe).join("|")})\\b`
    : "";
  const groups = [`(${ID_PART})`, `(${TIME_PART})`];
  if (assetPart) {
    groups.push(`(${assetPart})`);
  }
  const re = new RegExp(groups.join("|"), "g");

  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of clean.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) {
      nodes.push(<span key={key++}>{clean.slice(last, index)}</span>);
    }
    if (match[1] !== undefined) {
      nodes.push(<IdToken key={key++} value={match[1]} />);
    } else if (match[2] !== undefined) {
      nodes.push(<TimeToken key={key++} iso={match[2]} />);
    } else {
      nodes.push(
        <AssetToken
          key={key++}
          code={match[0]}
          issuer={assets.get(match[0])}
        />,
      );
    }
    last = index + match[0].length;
  }
  if (last < clean.length) {
    nodes.push(<span key={key++}>{clean.slice(last)}</span>);
  }
  return nodes;
}

/**
 * Renders model-produced text with Stellar ids and known asset codes turned
 * into linked, identiconed, or logoed references, and newlines preserved. The
 * text is untrusted, so it is sanitized and every id is re-validated first.
 */
export function AiRichText({
  text,
  assets = [],
  className,
}: {
  text: string;
  assets?: AiAsset[];
  className?: string;
}) {
  const assetMap = new Map<string, string | undefined>();
  for (const asset of assets) {
    assetMap.set(asset.code, asset.issuer);
  }
  return (
    <div className={cn("break-words whitespace-pre-wrap", className)}>
      {render(text, assetMap)}
    </div>
  );
}
