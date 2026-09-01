import { Skeleton } from "@journey-further/salient-ui/ui/skeleton";

import { DEFAULT_PAGE_SIZE } from "@/lib/logs/filters";

/** Rows drawn while a page loads. Fewer than a full page, but enough to fill
 * the viewport so the real table does not push the footer down when it lands. */
const SKELETON_ROW_COUNT = 12;

/**
 * The log table's loading state.
 *
 * Sized to match the real table's row height rather than showing a spinner:
 * a placeholder that collapses when the data arrives is a layout shift, which
 * is a bug, not a cosmetic detail.
 */
export function LogTableSkeleton({
  rows = SKELETON_ROW_COUNT,
}: {
  rows?: number;
}) {
  return (
    <div className="bg-card rounded-lg border" aria-hidden="true">
      <div className="flex h-12 items-center gap-4 border-b px-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-32" />
      </div>
      {Array.from({ length: Math.min(rows, DEFAULT_PAGE_SIZE) }, (_, index) => (
        <div
          key={index}
          className="flex h-13 items-center gap-4 border-b px-4 last:border-b-0"
        >
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  );
}
