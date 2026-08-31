import { useState } from "react";
import xlmIcon from "@/assets/xlm.svg";
import { assetIconUrl } from "@/lib/indexer/client";
import { ACTIVE_NETWORK } from "@/lib/network";
import { cn } from "@/lib/utils";

function hueOf(code: string) {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/**
 * XLM ships its bundled logo. An issued asset starts as a deterministic
 * letter chip and upgrades in place once the soroscan icon proxy serves
 * the logo its issuer published over SEP-1; the proxy fetches and caches
 * issuer images so viewers never talk to issuer hosts themselves. No
 * logo, a failed load, or a network without the proxy keeps the chip.
 */
export function AssetIcon({
  code,
  issuer,
  size = 20,
  className,
}: {
  code: string;
  issuer?: string;
  size?: number;
  className?: string;
}) {
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const [failedSrc, setFailedSrc] = useState<string>();
  if (code === "XLM") {
    return (
      <img
        src={xlmIcon}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        className={cn("shrink-0 -translate-y-px", className)}
      />
    );
  }
  const src =
    issuer === undefined
      ? undefined
      : assetIconUrl(ACTIVE_NETWORK, code, issuer);
  return (
    <span
      // sentence codes are uppercase, whose optical center sits above the
      // line-box center the flex centering uses; one pixel up corrects it
      className={cn("relative flex shrink-0 -translate-y-px", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span
        // the glyph lives in a pseudo-element so the letter never leaks
        // into the copyable text of a sentence the chip sits in
        data-glyph={code.slice(0, 1)}
        className={cn(
          "flex h-full w-full items-center justify-center rounded-full font-bold text-white transition-opacity before:content-[attr(data-glyph)]",
          loadedSrc === src && src !== undefined && "opacity-0",
        )}
        style={{
          // a glyph drawn inside the chip, so it scales with the chip
          // rather than sitting on the text scale
          fontSize: Math.round(size * 0.5),
          lineHeight: 1,
          background: `hsl(${hueOf(code)} 55% 45%)`,
        }}
      />
      {src !== undefined && failedSrc !== src ? (
        <img
          src={src}
          width={size}
          height={size}
          alt=""
          loading="lazy"
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
          className={cn(
            "absolute inset-0 h-full w-full rounded-full transition-opacity",
            loadedSrc === src ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
    </span>
  );
}
