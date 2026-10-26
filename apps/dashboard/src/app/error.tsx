"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

/**
 * The outline button's classes, copied from `buttonVariants` rather than
 * imported through `Button`.
 *
 * This boundary is a client component on EVERY route, the sign-in page
 * included — a page that otherwise ships no component code at all. Importing
 * `Button` here would pull class-variance-authority, clsx and tailwind-merge
 * into that page's bundle to style one control that is only ever seen when
 * something has already gone wrong. The two class lists have to be kept in
 * step by hand; `size="sm"` and `variant="outline"` are the pair to match.
 */
const OUTLINE_BUTTON_CLASS = [
  "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5",
  "rounded-md border px-3 text-xs font-medium whitespace-nowrap",
  "border-control bg-card text-foreground hover:bg-accent hover:text-accent-foreground",
  "transition-colors motion-reduce:transition-none",
  "focus-visible:ring-ring/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:outline-none",
].join(" ");

/**
 * The route error boundary.
 *
 * Deliberately does NOT render the app shell: the shell needs a session, and
 * a failure to resolve one is exactly the kind of thing that lands here. It
 * also shows no detail from the error — the message can carry server context —
 * only what happened and how to get out of it.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the server-side correlation id; the message itself stays
    // on the server.
    console.error("Dashboard route failed", error.digest);
  }, [error]);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center">
      <TriangleAlert className="text-destructive size-8" aria-hidden="true" />
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground max-w-prose text-sm">
        This page could not be loaded. Trying again usually helps; if it keeps
        happening, quote the reference below to whoever runs Stuffs Logger.
      </p>
      {error.digest === undefined ? null : (
        <p className="text-muted-foreground font-mono text-xs">
          Reference: {error.digest}
        </p>
      )}
      <button type="button" className={OUTLINE_BUTTON_CLASS} onClick={reset}>
        Try again
      </button>
    </main>
  );
}
