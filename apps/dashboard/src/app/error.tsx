"use client";

import { Button } from "@journey-further/salient-ui/ui/button";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

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
        happening, quote the reference below to whoever runs JF Logger.
      </p>
      {error.digest === undefined ? null : (
        <p className="text-muted-foreground font-mono text-xs">
          Reference: {error.digest}
        </p>
      )}
      <Button type="button" variant="outline" size="sm" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
