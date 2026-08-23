import { useParams } from "react-router";
import { Address } from "@/components/address";
import { EntityShell } from "@/features/entity-shell";
import { InvalidEntity } from "@/features/invalid-entity";
import { classifySearch } from "@/lib/search";

export function TxPage() {
  const { hash = "" } = useParams();
  const target = classifySearch(hash);
  if (target.type !== "tx") {
    return <InvalidEntity expected="transaction hash" value={hash} />;
  }
  return (
    <EntityShell
      title="Transaction"
      identifier={<Address value={target.value} />}
    >
      <p className="text-muted-foreground">
        Full transaction decoding lands here next: operations, decoded contract
        invocations, events, and failure diagnostics.
      </p>
    </EntityShell>
  );
}
