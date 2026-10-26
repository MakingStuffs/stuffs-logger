import { Skeleton } from "../ui/skeleton";

/** Rows drawn while the tokens load. A deployment rarely has more. */
const SKELETON_ROW_COUNT = 2;

/**
 * The token section's loading state: heading beside its action, the
 * retention note, then a table of single-line rows with a revoke control, so
 * the real content lands without shifting the page.
 */
export function ApiTokensSkeleton({
  rows = SKELETON_ROW_COUNT,
}: {
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <div className="flex h-7 items-center">
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-72 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>

      <Skeleton className="h-28 w-full rounded-lg" />

      <div className="bg-card rounded-lg border">
        <div className="border-b">
          <div className="flex h-10 items-center gap-6 px-3">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-6 border-b px-3 py-2 last:border-b-0"
          >
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="ml-auto h-8 w-20 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
