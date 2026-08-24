import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface EntityShellProps {
  title: string;
  identifier: ReactNode;
  children: ReactNode;
}

export function EntityShell({ title, identifier, children }: EntityShellProps) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <div className="mt-2 text-sm">{identifier}</div>
      <Card className="mt-8">
        <CardContent className="pt-6 text-sm">{children}</CardContent>
      </Card>
    </main>
  );
}
