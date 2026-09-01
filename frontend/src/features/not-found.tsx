import { Link } from "react-router";
import { appPath } from "@/lib/network";
import { useSeo } from "@/lib/seo";

export function NotFoundPage() {
  useSeo({ title: "Page not found - Soroscan", noindex: true });
  return (
    <main className="flex min-h-[70svh] flex-col items-center justify-center gap-3 px-4">
      <h1 className="text-3xl font-medium tracking-tight">Page not found</h1>
      <Link
        to={appPath("/")}
        className="text-link transition-colors hover:text-link-hover"
      >
        Back to home
      </Link>
    </main>
  );
}
