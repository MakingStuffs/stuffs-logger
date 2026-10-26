import { CardGridSkeleton } from "../ui-states/card-grid-skeleton";
import { Skeleton } from "../ui/skeleton";

/**
 * The overview's loading state: the summary line, then the grid.
 *
 * Two boundaries on the overview use it. The outer one does not yet know how
 * many applications exist and draws the default; the inner one has the list in
 * hand and passes its length, so the skeleton that sits under the slow
 * aggregate query has exactly as many cards as will replace it.
 *
 * @param count - How many cards will land, when known.
 */
export function ApplicationActivitySkeleton({ count }: { count?: number }) {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      {/* The `text-sm` summary sentence: one 20px line. */}
      <div className="flex h-5 items-center">
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <CardGridSkeleton count={count} variant="activity" />
    </div>
  );
}
