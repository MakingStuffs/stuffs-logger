import { Skeleton } from "../ui/skeleton";

/** Rows drawn while the keys load. An application rarely has more. */
const SKELETON_ROW_COUNT = 3;

/**
 * The ingest-key section's loading state.
 *
 * The keys are the second, tighter gate on an application's page and a second
 * query, so they stream in after the application itself. This holds their
 * place: the heading block beside its action, then a table whose rows are
 * built from a browser key's own parts — a `text-xs` key over an `h-8` copy
 * control inside `py-2` cells — so the real rows land without moving the page
 * footer.
 */
export function IngestKeysSkeleton({
  rows = SKELETON_ROW_COUNT,
}: {
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          {/* An `<h2>` at `text-lg` (28px) over a `text-sm` line (20px). */}
          <div className="flex h-7 items-center">
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-64 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>

      <div className="bg-card rounded-lg border">
        <div className="border-b">
          <div className="flex h-10 items-center gap-6 px-3">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-6 border-b px-3 py-2 last:border-b-0"
          >
            <Skeleton className="h-4 w-32" />
            <ChipSkeleton />
            <div className="flex flex-col gap-1">
              <div className="flex h-4 items-center">
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
            <Skeleton className="h-4 flex-1" />
            <ChipSkeleton />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A badge's footprint: `text-xs` inside `py-0.5` and a 1px border. */
function ChipSkeleton() {
  return (
    <div className="inline-flex rounded-full border border-transparent px-2 py-0.5">
      <Skeleton className="h-4 w-14 rounded-full" />
    </div>
  );
}
