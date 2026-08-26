import { useEffect, useState } from "react";
import { Link, Outlet } from "react-router";
import { SearchIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/logo";
import { Omnibox } from "@/components/omnibox";
import { SiteFooter } from "@/components/site-footer";
import {
  ACTIVE_NETWORK,
  appPath,
  NETWORKS,
  networkToggleUrl,
} from "@/lib/network";

function NetworkChip() {
  const target = ACTIVE_NETWORK === "mainnet" ? "Testnet" : "Mainnet";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={networkToggleUrl(window.location)}
          aria-label="Switch network"
          className="flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2.5 font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          <span
            className={
              ACTIVE_NETWORK === "mainnet"
                ? "size-1.5 rounded-full bg-primary"
                : "size-1.5 rounded-full bg-muted-foreground"
            }
            aria-hidden="true"
          />
          {NETWORKS[ACTIVE_NETWORK].label}
        </a>
      </TooltipTrigger>
      <TooltipContent>Click to switch to {target}</TooltipContent>
    </Tooltip>
  );
}

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  );
}

export function Layout() {
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isShortcut =
        (event.key === "k" && (event.metaKey || event.ctrlKey)) ||
        (event.key === "/" && !isTypingTarget(event.target));
      if (isShortcut) {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex min-h-svh flex-col">
      {/* opaque, not translucent: rows scrolling underneath a sticky bar
          read as a rendering fault rather than as depth */}
      <header className="sticky top-0 z-40 bg-background">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link to={appPath("/")} className="flex items-center gap-2.5">
            <LogoMark size={26} />
            <span className="-translate-y-[1.5px] text-xl font-semibold tracking-tight">
              soroscan
            </span>
          </Link>
          <Button
            variant="outline"
            onClick={() => setSearchOpen(true)}
            className="ml-auto w-full max-w-xs justify-between border-0 bg-muted/60 text-muted-foreground shadow-none hover:bg-muted sm:flex"
          >
            <span className="flex items-center gap-2">
              <SearchIcon className="size-4" aria-hidden="true" />
              Search
            </span>
            <kbd className="rounded bg-muted px-1.5 font-mono text-xs">/</kbd>
          </Button>
          <NetworkChip />
        </div>
      </header>
      <Omnibox open={searchOpen} onOpenChange={setSearchOpen} />
      <div className="flex-1">
        <Outlet />
      </div>
      <SiteFooter />
    </div>
  );
}
