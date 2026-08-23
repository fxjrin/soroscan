import { Link } from "react-router";
import { appPath } from "@/lib/network";

export function NotFoundPage() {
  return (
    <main className="flex min-h-[70svh] flex-col items-center justify-center gap-3 px-4">
      <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
      <Link to={appPath("/")} className="text-sm underline">
        Back to home
      </Link>
    </main>
  );
}
