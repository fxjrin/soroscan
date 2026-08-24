import { useState, type CSSProperties } from "react";

interface LedgerPulseProps {
  startedAtMs: number;
  now: number;
  seconds?: number;
  fromProgress?: number;
  size?: number;
}

const COMPLETE_MS = 150;
const DRAIN_MS = 350;
const POP_MS = 500; // scale beat lands with the intro sweeps, settled as the fill leaves

/**
 * Gold ring anchored to the moment the newest ledger reached us, moving
 * clockwise only: the head fills over the average cadence; on a new
 * ledger the head finishes its lap, the tail drains once around, and
 * the ring beats one bounced scale. The caller must key this component
 * by arrival: timing is frozen per mount, so mid-cycle updates never
 * restart the animation.
 */
export function LedgerPulse({
  startedAtMs,
  now,
  seconds = 5.5,
  fromProgress = 0,
  size = 44,
}: LedgerPulseProps) {
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const elapsed = Math.max(0, (now - startedAtMs) / 1000);

  const [mountAnimation] = useState(() => {
    const startMs = -elapsed * 1000; // anchor the whole timeline at the arrival
    if (fromProgress === 0) {
      return {
        arc: `ring-fill ${seconds}s linear ${startMs}ms forwards`,
        pop: undefined,
      };
    }
    return {
      arc: [
        `ring-complete ${COMPLETE_MS}ms var(--ease-smooth-out) ${startMs}ms forwards`,
        `ring-drain ${DRAIN_MS}ms var(--ease-smooth-out) ${COMPLETE_MS + startMs}ms forwards`,
        `ring-fill ${seconds}s linear ${COMPLETE_MS + DRAIN_MS + startMs}ms forwards`,
      ].join(", "),
      pop: `ring-pop ${POP_MS}ms var(--ease-bounce) ${startMs}ms both`,
    };
  });

  // ring-fill and ring-drain pin both stroke properties in their keyframes:
  // an implicit value would inherit whatever the finished earlier animation
  // holds and freeze the ring there
  const ringStyle = {
    strokeDashoffset: circumference,
    animation: mountAnimation.arc,
    "--ring-from": `${circumference * (1 - fromProgress)}px`,
    "--ring-circ": `${circumference}px`,
  } as CSSProperties;

  return (
    <span
      className={
        mountAnimation.pop
          ? "ring-pop relative inline-flex shrink-0"
          : "relative inline-flex shrink-0"
      }
      style={{ width: size, height: size, animation: mountAnimation.pop }}
      role="img"
      aria-label={`${Math.floor(elapsed)} seconds waiting for the next ledger`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          className="ring-progress"
          style={ringStyle}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-mono text-[10px] tabular-nums text-muted-foreground"
        aria-hidden="true"
      >
        {Math.floor(elapsed)}s
      </span>
    </span>
  );
}
