import { TriangleAlert } from "lucide-react";
import Link from "next/link";

import type { FilterIssue } from "@/lib/logs/filters";

import { Button } from "../ui/button";

import { LOGS_PATH } from "./search-params";

/**
 * What a rejected URL looks like.
 *
 * Filters are shareable, hand-editable and bookmarkable, so an invalid one is
 * an ordinary input rather than an exceptional condition — it gets an
 * explanation and a way out, not a stack trace or a blank screen.
 */
export function FilterIssues({ issues }: { issues: FilterIssue[] }) {
  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/5 flex flex-col items-start gap-3 rounded-lg border p-6"
    >
      <div className="flex items-center gap-2">
        <TriangleAlert className="text-destructive size-5" aria-hidden="true" />
        <h2 className="text-base font-semibold">
          These filters could not be applied
        </h2>
      </div>

      <p className="text-muted-foreground text-sm">
        Part of the address is not a filter this page understands, so nothing
        has been loaded. Clear the filters and start again, or fix the values
        listed below.
      </p>

      <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
        {issues.map((issue, index) => (
          <li key={`${issue.path}-${index}`}>
            {issue.path.length > 0 ? (
              <>
                <span className="font-mono text-xs">{issue.path}</span>:{" "}
              </>
            ) : null}
            {issue.message}
          </li>
        ))}
      </ul>

      <Button asChild variant="outline" size="sm">
        <Link href={LOGS_PATH}>Clear filters</Link>
      </Button>
    </div>
  );
}
