import { sanitizeChainText } from "@/lib/format";

interface UntrustedTextProps {
  value: string;
  maxLength?: number;
  className?: string;
}

/**
 * The only allowed way to render a chain-derived string (memos, asset
 * codes, contract metadata, toml fields). Sanitizes hostile characters,
 * isolates bidi context, and caps length.
 */
export function UntrustedText({
  value,
  maxLength = 120,
  className,
}: UntrustedTextProps) {
  const clean = sanitizeChainText(value);
  const truncated = clean.length > maxLength;
  const display = truncated ? clean.slice(0, maxLength) + "..." : clean;
  return (
    <bdi className={className} title={truncated ? clean : undefined}>
      {display}
    </bdi>
  );
}
