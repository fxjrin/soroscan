import type { ReactNode } from "react";
import { TreeElbow, TREE_LINE, TREE_STEP } from "@/components/tree-lines";

/**
 * A labeled group of steps, connected the same way the call tree is: an
 * elbow line from one to the next. Each group starts its own chain rather
 * than continuing whatever came before it, so the label is what says "new
 * section", not the line -- a step is never implied to branch from
 * something above it that it has no real relationship to.
 */
export function StepGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode[];
}) {
  if (children.length === 0) {
    return null;
  }
  return (
    <>
      <p className="pb-2 pt-3 font-medium text-foreground/80">{label}</p>
      <ol>
        {children.map((child, index) => (
          <li
            key={index}
            className="relative py-2"
            style={{ paddingInlineStart: TREE_STEP }}
          >
            <TreeElbow start={TREE_LINE} last={index === children.length - 1} />
            {child}
          </li>
        ))}
      </ol>
    </>
  );
}
