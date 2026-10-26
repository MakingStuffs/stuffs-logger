import { DEFAULT_PAGE_SIZE } from "@/lib/logs/constants";

import { Skeleton } from "../ui/skeleton";

/** Rows drawn while a page loads. Fewer than a full page, but enough to fill
 * the viewport so the real table does not push the footer down when it lands. */
const SKELETON_ROW_COUNT = 12;

/**
 * The log table's loading state.
 *
 * Sized to match the real table rather than showing a spinner: a placeholder
 * that collapses when the data arrives is a layout shift, which is a bug, not
 * a cosmetic detail.
 *
 * The heights are NOT set as numbers. Each placeholder row is built from the
 * same box model as a real row — `py-2` cells around a `size-7` expand
 * control, under a 1px rule — so it comes out at the same 45px without a
 * magic value that would drift the next time the row's padding changed. The
 * header is a `TableHead`'s `h-10` over its own rule in the same way.
 *
 * The paging line beneath the table is reserved too: a `text-sm` summary
 * beside an `h-8` control. The real one lands in the same moment as the rows,
 * and a line that appears from nothing pushes the footer down just as a table
 * would.
 */
export function LogTableSkeleton({
  rows = SKELETON_ROW_COUNT,
}: {
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="bg-card rounded-lg border">
        <div className="border-b">
          <div className="flex h-10 items-center gap-4 px-3">
            <div className="w-7" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        {Array.from(
          { length: Math.min(rows, DEFAULT_PAGE_SIZE) },
          (_, index) => (
            <div
              key={index}
              className="flex items-center gap-4 border-b px-3 py-2 last:border-b-0"
            >
              <div className="flex size-7 shrink-0 items-center justify-center">
                <Skeleton className="size-4 rounded-sm" />
              </div>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-16 rounded-sm" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ),
        )}
      </div>

      <div className="flex h-8 items-center justify-between gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
    </div>
  );
}
