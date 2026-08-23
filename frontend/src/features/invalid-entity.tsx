import { Link } from "react-router";
import { UntrustedText } from "@/components/untrusted-text";
import { appPath } from "@/lib/network";

interface InvalidEntityProps {
  expected: string;
  value: string;
}

export function InvalidEntity({ expected, value }: InvalidEntityProps) {
  return (
    <main className="flex min-h-[70svh] flex-col items-center justify-center gap-3 px-4">
      <h1 className="text-2xl font-bold tracking-tight">
        Not a valid {expected}
      </h1>
      <p className="max-w-full font-mono text-sm text-muted-foreground">
        <UntrustedText value={value} maxLength={80} />
      </p>
      <Link to={appPath("/")} className="text-sm underline">
        Back to home
      </Link>
    </main>
  );
}
