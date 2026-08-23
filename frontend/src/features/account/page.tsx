import { useParams } from "react-router";
import { Address } from "@/components/address";
import { EntityShell } from "@/features/entity-shell";
import { InvalidEntity } from "@/features/invalid-entity";
import { classifySearch } from "@/lib/search";

export function AccountPage() {
  const { address = "" } = useParams();
  const target = classifySearch(address);
  if (target.type !== "account") {
    return <InvalidEntity expected="account address" value={address} />;
  }
  return (
    <EntityShell title="Account" identifier={<Address value={target.value} />}>
      <p className="text-muted-foreground">
        Balances, trustlines, signers, and transaction history land here next.
        Muxed (M...) addresses will resolve to their base account.
      </p>
    </EntityShell>
  );
}
