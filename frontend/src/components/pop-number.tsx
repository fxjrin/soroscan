import { cn } from "@/lib/utils";

/**
 * transitions.dev number pop-in: keyed remount replays the per-digit
 * entrance whenever the value changes; the last two characters ride in
 * on the documented stagger.
 */
export function PopNumber({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const chars = value.split("");
  return (
    <span key={value} className={cn("t-digit-group is-animating", className)}>
      {chars.map((char, index) => (
        <span
          key={`${index}-${char}`}
          className="t-digit"
          data-stagger={
            index === chars.length - 2
              ? "1"
              : index === chars.length - 1
                ? "2"
                : undefined
          }
        >
          {char}
        </span>
      ))}
    </span>
  );
}
