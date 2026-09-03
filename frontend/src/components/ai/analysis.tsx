import { Link } from "react-router";
import { ArrowGlyph } from "@/components/ai/icons";
import { AiRichText } from "@/components/ai/rich-text";
import type { AiAnalysis, AiView } from "@/lib/ai/client";
import { appPath } from "@/lib/network";

const VIEW_LABELS: Record<string, string> = {
  history: "View all transactions",
  offers: "View open offers",
  operations: "View all operations",
  invocations: "View all invocations",
  interface: "View contract interface",
  storage: "View contract storage",
  "balance-changes": "View balance changes",
  trace: "View execution trace",
};

function viewHref(view: AiView): string {
  return appPath(`/${view.kind}/${view.id}?tab=${view.tab}`);
}

export function AiAnalysisView({ analysis }: { analysis: AiAnalysis }) {
  const assets = analysis.assets;
  return (
    <div className="space-y-3">
      <AiRichText
        text={analysis.summary}
        assets={assets}
        className="text-sm leading-relaxed text-foreground"
      />
      {analysis.highlights.length > 0 ? (
        <ul className="space-y-1.5">
          {analysis.highlights.map((item) => (
            <li key={item} className="flex gap-2 text-sm text-foreground">
              <span
                className="mt-[0.5em] size-1 shrink-0 rounded-full bg-primary"
                aria-hidden="true"
              />
              <AiRichText text={item} assets={assets} />
            </li>
          ))}
        </ul>
      ) : null}
      {analysis.caveats.length > 0 ? (
        <div className="space-y-1 border-t border-border pt-2">
          {analysis.caveats.map((item) => (
            <AiRichText
              key={item}
              text={item}
              assets={assets}
              className="text-xs text-muted-foreground"
            />
          ))}
        </div>
      ) : null}
      {analysis.view ? (
        <Link
          to={viewHref(analysis.view)}
          className="inline-flex items-center gap-1 text-xs font-medium text-link transition-colors hover:text-link-hover"
        >
          {VIEW_LABELS[analysis.view.tab] ?? "View on Soroscan"}
          <ArrowGlyph className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}
