import { useQuery } from "@tanstack/react-query";
import { LogoMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ACTIVE_NETWORK } from "@/lib/network";
import { healthQuery } from "@/lib/queries";

export function HomePage() {
  const health = useQuery(healthQuery(ACTIVE_NETWORK));

  return (
    <main className="flex min-h-[70svh] flex-col items-center justify-center gap-4 px-4">
      <LogoMark size={64} />
      <h1 className="text-4xl font-bold tracking-tight">Soroscan</h1>
      <p className="text-center text-muted-foreground">
        A Stellar block explorer with a modern, contract-first UI.
      </p>
      <div className="flex items-center gap-2">
        <Badge variant="secondary">pre-alpha</Badge>
        {health.isPending ? (
          <Skeleton className="h-[22px] w-36 rounded-full" />
        ) : health.isError ? (
          <Badge variant="outline" className="text-muted-foreground">
            network unreachable
          </Badge>
        ) : (
          <Badge variant="outline" className="font-mono tabular-nums">
            ledger {health.data.latestLedger.toLocaleString("en-US")}
          </Badge>
        )}
      </div>
    </main>
  );
}
