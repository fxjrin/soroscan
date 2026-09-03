const STAR_GOLD = "#F5C84C";

export function LogoMark({
  size = 28,
  className,
  starClassName,
}: {
  size?: number;
  className?: string;
  starClassName?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="8 8 48 48"
      role="img"
      aria-label="Soroscan"
      className={className}
    >
      <polyline
        points="25,20 13,32 25,44"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="39,20 51,32 39,44"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className={starClassName}
        d="M32 23l2.6 6.4 6.4 2.6-6.4 2.6-2.6 6.4-2.6-6.4-6.4-2.6 6.4-2.6z"
        fill={STAR_GOLD}
      />
    </svg>
  );
}
