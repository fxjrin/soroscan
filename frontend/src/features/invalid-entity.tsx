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
      <h1 className="text-3xl font-medium tracking-tight">
        Not a valid {expected}
      </h1>
      <p className="max-w-full font-mono text-muted-foreground">
        <UntrustedText value={value} maxLength={80} />
      </p>
      <Link
        to={appPath("/")}
        className="text-link transition-colors hover:text-link-hover"
      >
        Back to home
      </Link>
    </main>
  );
}
