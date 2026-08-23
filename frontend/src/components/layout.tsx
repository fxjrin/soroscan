import { Link, Outlet } from "react-router";
import { Badge } from "@/components/ui/badge";
import { LogoMark } from "@/components/logo";
import { SearchBox } from "@/components/search-box";
import {
  ACTIVE_NETWORK,
  appPath,
  NETWORKS,
  networkToggleUrl,
} from "@/lib/network";

function NetworkChip() {
  return (
    <a href={networkToggleUrl(window.location)} aria-label="Switch network">
      <Badge variant={ACTIVE_NETWORK === "mainnet" ? "secondary" : "outline"}>
        {NETWORKS[ACTIVE_NETWORK].label}
      </Badge>
    </a>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-3">
          <Link
            to={appPath("/")}
            className="flex items-center gap-2 font-bold tracking-tight"
          >
            <LogoMark size={24} />
            soroscan
          </Link>
          <SearchBox className="ml-auto w-full max-w-md" />
          <NetworkChip />
        </div>
      </header>
      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  );
}
