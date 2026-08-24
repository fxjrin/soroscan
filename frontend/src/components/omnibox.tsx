import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRightLeft, FileCode2, Layers, Wallet } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { appPath } from "@/lib/network";
import {
  classifySearch,
  searchTargetPath,
  type SearchTarget,
} from "@/lib/search";

const RECENTS_KEY = "soroscan.recent-searches";
const MAX_RECENTS = 5;

const TYPE_LABEL: Record<Exclude<SearchTarget["type"], "unknown">, string> = {
  account: "Account",
  contract: "Contract",
  tx: "Transaction",
  ledger: "Ledger",
};

const SEARCH_KINDS = [
  {
    icon: Wallet,
    name: "Account",
    hint: "Stellar address starting with G, 56 characters",
  },
  {
    icon: FileCode2,
    name: "Contract",
    hint: "Soroban contract starting with C, 56 characters",
  },
  {
    icon: ArrowRightLeft,
    name: "Transaction",
    hint: "64-character hex hash",
  },
  {
    icon: Layers,
    name: "Ledger",
    hint: "Sequence number, e.g. 64090000",
  },
];

function loadRecents(): SearchTarget[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(RECENTS_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) {
      return [];
    }
    // storage is writable same-origin state: re-classify every entry and
    // drop anything that no longer parses as a real search target
    return parsed
      .map((entry) => {
        const value = (entry as { value?: unknown })?.value;
        return classifySearch(typeof value === "string" ? value : "");
      })
      .filter((target) => target.type !== "unknown")
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function saveRecent(target: SearchTarget) {
  try {
    const next = [
      target,
      ...loadRecents().filter((r) => r.value !== target.value),
    ];
    localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify(next.slice(0, MAX_RECENTS)),
    );
  } catch {
    // storage unavailable; recents are a convenience only
  }
}

function shortValue(value: string) {
  return value.length > 20
    ? `${value.slice(0, 8)}...${value.slice(-6)}`
    : value;
}

export function Omnibox({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const recents = open ? loadRecents() : [];

  const target = classifySearch(query);
  const path = searchTargetPath(target);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery("");
    }
    onOpenChange(next);
  }

  function go(destination: SearchTarget) {
    const to = searchTargetPath(destination);
    if (!to) {
      return;
    }
    saveRecent(destination);
    handleOpenChange(false);
    void navigate(appPath(to));
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Search"
      description="Search the network"
      className="top-[35%] translate-y-[-35%] border-0 shadow-2xl sm:max-w-2xl"
    >
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Account, contract, tx hash, or ledger sequence"
          className="h-12 font-mono text-base"
        />
        <CommandList className="max-h-[420px]">
          {query.trim().length > 0 ? (
            <CommandEmpty>
              Not a valid address, transaction hash, or ledger sequence.
            </CommandEmpty>
          ) : null}
          {path && target.type !== "unknown" ? (
            <CommandGroup heading="Go to">
              <CommandItem
                value={query}
                onSelect={() => go(target)}
                className="font-mono"
              >
                <span className="text-muted-foreground">
                  {TYPE_LABEL[target.type]}
                </span>
                {shortValue(target.value)}
              </CommandItem>
            </CommandGroup>
          ) : null}
          {query.trim().length === 0 && recents.length > 0 ? (
            <CommandGroup heading="Recent">
              {recents.map((recent) => (
                <CommandItem
                  key={recent.value}
                  value={`recent-${recent.value}`}
                  onSelect={() => go(recent)}
                  className="font-mono"
                >
                  <span className="text-muted-foreground">
                    {recent.type === "unknown" ? "?" : TYPE_LABEL[recent.type]}
                  </span>
                  {shortValue(recent.value)}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {query.trim().length === 0 ? (
            <div>
              <div className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">
                What you can search
              </div>
              {SEARCH_KINDS.map((kind) => (
                <div
                  key={kind.name}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <kind.icon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="w-24 shrink-0 font-medium">{kind.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {kind.hint}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </CommandList>
        <div className="flex items-center gap-4 border-t border-border/50 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              enter
            </kbd>
            open
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              esc
            </kbd>
            close
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              /
            </kbd>
            from anywhere
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}
