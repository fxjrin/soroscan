import { useEffect, useState } from "react";
import { Link, Outlet } from "react-router";
import { CheckIcon, MoonIcon, SearchIcon, SunIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/logo";
import { Omnibox } from "@/components/omnibox";
import { SiteFooter } from "@/components/site-footer";
import {
  ACTIVE_NETWORK,
  appPath,
  NETWORKS,
  networkUrl,
  type NetworkId,
} from "@/lib/network";
import { activeTheme, applyTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NETWORK_IDS = Object.keys(NETWORKS) as NetworkId[];

function NetworkDot({ id }: { id: NetworkId }) {
  return (
    <span
      className={cn(
        "size-1.5 rounded-full",
        id === "mainnet" ? "bg-primary" : "bg-muted-foreground",
      )}
      aria-hidden="true"
    />
  );
}

function NetworkSwitcher() {
  const active = ACTIVE_NETWORK;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Switch network"
          className="flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2.5 font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          <NetworkDot id={active} />
          {NETWORKS[active].label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-1">
        {NETWORK_IDS.map((id) => (
          <a
            key={id}
            href={networkUrl(window.location, id)}
            className={cn(
              "flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted",
              id === active
                ? "font-medium text-foreground"
                : "text-muted-foreground",
            )}
          >
            <NetworkDot id={id} />
            {NETWORKS[id].label}
            {id === active ? (
              <CheckIcon className="ml-auto size-3.5" aria-hidden="true" />
            ) : null}
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => activeTheme());
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Switch to the ${next} theme`}
          onClick={() => {
            applyTheme(next);
            setTheme(next);
          }}
          className="flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          {/* the icon names where the switch goes, not where you are */}
          {theme === "dark" ? (
            <SunIcon className="size-4" aria-hidden="true" />
          ) : (
            <MoonIcon className="size-4" aria-hidden="true" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>Switch to the {next} theme</TooltipContent>
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
          <NetworkSwitcher />
          <ThemeToggle />
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
