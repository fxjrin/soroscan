import xlmIcon from "@/assets/xlm.svg";
import { cn } from "@/lib/utils";

function hueOf(code: string) {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/**
 * Known assets get their bundled logo; everything else gets a
 * deterministic letter chip. Icons never load from third-party hosts,
 * which could track viewers and break offline use.
 */
export function AssetIcon({
  code,
  size = 16,
  className,
}: {
  code: string;
  size?: number;
  className?: string;
}) {
  if (code === "XLM") {
    return (
      <img
        src={xlmIcon}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        className={cn("shrink-0", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[2px] font-bold text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        // a glyph drawn inside the chip, so it scales with the chip
        // rather than sitting on the text scale
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
        background: `hsl(${hueOf(code)} 55% 45%)`,
      }}
      aria-hidden="true"
    >
      {code.slice(0, 1)}
    </span>
  );
}
