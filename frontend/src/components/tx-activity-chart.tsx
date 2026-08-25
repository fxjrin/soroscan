import { useState, type PointerEvent } from "react";
import { sanitizeChainText } from "@/lib/format";
import type { LedgerRecord } from "@/lib/horizon/client";

interface ChartPoint {
  sequence: number;
  txs: number;
  time: string;
}

const VIEW_W = 560;
const VIEW_H = 100;

function toPoints(records: LedgerRecord[]): ChartPoint[] {
  return records
    .slice()
    .reverse()
    .map((record) => ({
      sequence: record.sequence,
      txs:
        record.successful_transaction_count + record.failed_transaction_count,
      time: sanitizeChainText(record.closed_at).slice(11, 19),
    }));
}

function coords(points: ChartPoint[], max: number) {
  const step = points.length > 1 ? VIEW_W / (points.length - 1) : VIEW_W;
  return points.map((point, index) => ({
    x: index * step,
    y: VIEW_H - (point.txs / max) * (VIEW_H - 8),
  }));
}

/**
 * Transactions per ledger as a single gold series: hand-rolled SVG so the
 * one chart on the page does not cost a 90KB charting library.
 */
export function TxActivityChart({ records }: { records: LedgerRecord[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = toPoints(records);
  const max = Math.max(...points.map((point) => point.txs), 1);
  const xy = coords(points, max);

  const line = xy
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`;
  const last = points[points.length - 1];
  const lastXy = xy[xy.length - 1];

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, index)));
  }

  const active = hover !== null ? points[hover] : null;
  const activeXy = hover !== null ? xy[hover] : null;

  return (
    <div>
      <div
        className="relative h-[92px] w-full"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="size-full overflow-visible"
          role="img"
          aria-label={`Transactions per ledger, currently ${last.txs} in ledger ${last.sequence}`}
        >
          <defs>
            <linearGradient id="txFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1="0"
              x2={VIEW_W}
              y1={VIEW_H * fraction}
              y2={VIEW_H * fraction}
              stroke="var(--border)"
              strokeOpacity="0.6"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={area} fill="url(#txFill)" />
          <path
            d={line}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
          style={{
            left: `${(lastXy.x / VIEW_W) * 100}%`,
            top: `${(lastXy.y / VIEW_H) * 100}%`,
          }}
          aria-hidden="true"
        />
        {active && activeXy ? (
          <>
            <span
              className="pointer-events-none absolute inset-y-0 w-px bg-muted-foreground/40"
              style={{ left: `${(activeXy.x / VIEW_W) * 100}%` }}
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 font-mono text-xs text-popover-foreground shadow-md"
              style={{
                left: `${Math.min(88, Math.max(12, (activeXy.x / VIEW_W) * 100))}%`,
                top: "-8px",
              }}
            >
              <div>{active.sequence.toLocaleString("en-US")}</div>
              <div className="text-muted-foreground">
                <span>{active.txs}</span> tx {"\u00b7"} {active.time}
              </div>
            </div>
          </>
        ) : null}
      </div>
      <div className="mt-1 flex justify-between font-mono text-xs text-muted-foreground">
        <span>{points[0].time.slice(0, 5)}</span>
        <span>{last.time.slice(0, 5)}</span>
      </div>
    </div>
  );
}
