import { useState } from "react";
import { useNavigate } from "react-router";
import { Input } from "@/components/ui/input";
import { appPath } from "@/lib/network";
import { classifySearch, searchTargetPath } from "@/lib/search";

export function SearchBox({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const path = searchTargetPath(classifySearch(value));
    if (!path) {
      setInvalid(value.trim().length > 0);
      return;
    }
    setInvalid(false);
    setValue("");
    void navigate(appPath(path));
  }

  return (
    <form onSubmit={submit} className={className} role="search">
      <Input
        type="search"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
        placeholder="Search account, contract, tx hash, or ledger"
        aria-label="Search"
        aria-invalid={invalid || undefined}
        className="font-mono text-sm"
      />
      {invalid ? (
        <p className="mt-1 text-xs text-destructive" role="alert">
          Not a valid address, transaction hash, or ledger sequence.
        </p>
      ) : null}
    </form>
  );
}
