import { Button } from "@journey-further/salient-ui/ui/button";
import { FileQuestion } from "lucide-react";
import Link from "next/link";

/** The 404 page. Standalone, because a missing route may be missing a session too. */
export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center">
      <FileQuestion
        className="text-muted-foreground size-8"
        aria-hidden="true"
      />
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-muted-foreground max-w-prose text-sm">
        This page does not exist. Logs are also removed automatically once they
        pass their retention window, so a link to an old event will eventually
        stop resolving.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/">Back to the overview</Link>
      </Button>
    </main>
  );
}
