import { Link } from "react-router";
import { AssetIcon } from "@/components/asset-icon";
import { UntrustedText } from "@/components/untrusted-text";
import { assetKey, highlightAsset } from "@/lib/asset-highlight";
import { assetPath, isNativeAsset, useAssetMeta } from "@/lib/asset-meta";
import { truncateMiddle } from "@/lib/format";
import { cn } from "@/lib/utils";

const ORIGIN_CLASS = "truncate text-xs text-muted-foreground";

/**
 * An asset named anywhere in the ui: icon, code, and where it comes from,
 * the whole thing linking to the asset page. Origin is the issuer's own
 * domain when it publishes one over SEP-1, and the truncated issuer
 * address otherwise, so a look-alike code always shows what backs it.
 */
export function AssetLink({
  code,
  issuer,
  showDomain = true,
  className,
}: {
  code: string;
  issuer?: string;
  showDomain?: boolean;
  className?: string;
}) {
  const meta = useAssetMeta(code, issuer);
  // a credit asset whose record carries no issuer names no page to open
  if (!isNativeAsset(code, issuer) && issuer === undefined) {
    return (
      <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
        <AssetIcon code={code} issuer={issuer} />
        <UntrustedText value={code} maxLength={12} />
      </span>
    );
  }
  const key = assetKey(code, issuer);
  return (
    // the literal spaces cost the flex layout nothing and keep the
    // mention reading as words when selected, copied, or matched
    <Link
      to={assetPath(code, issuer)}
      data-asset={key}
      onMouseEnter={() => highlightAsset(key)}
      onMouseLeave={() => highlightAsset(null)}
      className={cn("group/asset flex min-w-0 items-center gap-1.5", className)}
    >
      <AssetIcon code={code} issuer={issuer} />
      <span className="asset-code text-link transition-colors group-hover/asset:text-link-hover">
        <UntrustedText value={code} maxLength={12} />
      </span>
      {showDomain ? (
        <AssetOrigin issuer={issuer} domain={meta?.domain} />
      ) : null}
    </Link>
  );
}

// the domain is issuer-authored text and goes through UntrustedText; the
// issuer address is a strkey from a fixed alphabet and renders as is
function AssetOrigin({ issuer, domain }: { issuer?: string; domain?: string }) {
  if (domain !== undefined) {
    return (
      <>
        {" "}
        <UntrustedText value={domain} maxLength={30} className={ORIGIN_CLASS} />
      </>
    );
  }
  if (issuer !== undefined) {
    return (
      <>
        {" "}
        <span className={cn(ORIGIN_CLASS, "font-mono")}>
          {truncateMiddle(issuer)}
        </span>
      </>
    );
  }
  return null;
}
