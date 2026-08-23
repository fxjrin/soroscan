import { LogoMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";

export function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4">
      <LogoMark size={64} />
      <h1 className="text-4xl font-bold tracking-tight">Soroscan</h1>
      <p className="text-muted-foreground">
        A Stellar block explorer with a modern, contract-first UI.
      </p>
      <Badge variant="secondary">pre-alpha</Badge>
    </main>
  );
}
