import { UntrustedText } from "@/components/untrusted-text";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AmountProps {
  value: string;
  decimals?: number;
  code?: string;
  className?: string;
}

export function Amount({ value, decimals = 7, code, className }: AmountProps) {
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {formatAmount(value, decimals)}
      {code ? (
        <span className="text-muted-foreground">
          {" "}
          <UntrustedText value={code} maxLength={12} />
        </span>
      ) : null}
    </span>
  );
}
