import { useParams } from "react-router";
import { Address } from "@/components/address";
import { EntityShell } from "@/features/entity-shell";
import { InvalidEntity } from "@/features/invalid-entity";
import { classifySearch } from "@/lib/search";

export function ContractPage() {
  const { contractId = "" } = useParams();
  const target = classifySearch(contractId);
  if (target.type !== "contract") {
    return <InvalidEntity expected="contract address" value={contractId} />;
  }
  return (
    <EntityShell title="Contract" identifier={<Address value={target.value} />}>
      <p className="text-muted-foreground">
        Contract metadata, interface, storage, live events, and read-only
        invocation land here next.
      </p>
    </EntityShell>
  );
}
