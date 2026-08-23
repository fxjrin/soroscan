import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface EntityShellProps {
  title: string;
  identifier: ReactNode;
  children: ReactNode;
}

export function EntityShell({ title, identifier, children }: EntityShellProps) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <div className="mt-2 text-sm">{identifier}</div>
      <Card className="mt-6">
        <CardContent className="pt-6 text-sm">{children}</CardContent>
      </Card>
    </main>
  );
}
