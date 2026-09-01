import { Skeleton } from "@journey-further/salient-ui/ui/skeleton";

/** Cards drawn while a grid loads. */
const DEFAULT_CARD_COUNT = 3;

/**
 * The loading state for a grid of cards.
 *
 * Each placeholder occupies the same footprint as a real card, so the grid
 * does not resize when the data lands — a spinner that collapses into a
 * three-column grid is a layout shift, and layout shift is a defect.
 */
export function CardGridSkeleton({
  cards = DEFAULT_CARD_COUNT,
}: {
  cards?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: cards }, (_, index) => (
        <div
          key={index}
          className="bg-card flex h-52 flex-col gap-4 rounded-lg border p-6"
        >
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-24" />
          <div className="flex flex-1 items-end gap-6">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-6 w-14 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
