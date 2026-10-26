import { Card, CardContent, CardFooter, CardHeader } from "../ui/card";
import { Skeleton } from "../ui/skeleton";

/** Cards drawn while a grid loads, when the real number is not yet known. */
const DEFAULT_CARD_COUNT = 3;

/**
 * Which card the placeholders stand in for.
 *
 * The overview's activity card and the applications list's card share a
 * header and a footer but not a body — three metrics against one line of
 * description — and the difference is a few tens of pixels. One shape for
 * both would shift whichever grid it was wrong for.
 */
export type CardGridSkeletonVariant = "activity" | "application";

/**
 * The loading state for a grid of cards.
 *
 * Each placeholder is built from the real card's own parts, with a skeleton
 * block in each line at that line's height, so the grid does not resize when
 * the data lands. A spinner that collapses into a three-column grid is a
 * layout shift, and layout shift is a defect.
 *
 * @param count - How many cards will land. Pass it when it is known — a page
 *   that has already loaded its application list knows exactly how many —
 *   and leave it for the default when it is not.
 * @param variant - See {@link CardGridSkeletonVariant}.
 */
export function CardGridSkeleton({
  count = DEFAULT_CARD_COUNT,
  variant = "activity",
}: {
  count?: number;
  variant?: CardGridSkeletonVariant;
}) {
  return (
    <div
      aria-hidden="true"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} className="flex h-full flex-col">
          <CardHeader>
            {/* `CardTitle` is `text-base leading-snug`: a 22px line. */}
            <div className="flex h-5.5 items-center">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-24" />
            </div>
          </CardHeader>

          <CardContent className="flex-1">
            {variant === "activity" ? <ActivityBody /> : <ApplicationBody />}
          </CardContent>

          <CardFooter className="gap-4">
            <div className="flex h-5 items-center">
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="flex h-5 items-center">
              <Skeleton className="h-3 w-32" />
            </div>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

/** Three metrics: a `text-xs` label over a `text-2xl` figure. */
function ActivityBody() {
  return (
    <div className="grid grid-cols-3 gap-4">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex flex-col gap-1">
          <div className="flex h-4 items-center">
            <Skeleton className="h-3 w-12" />
          </div>
          <div className="flex h-8 items-center">
            <Skeleton className="h-6 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** One `text-sm` line of description. */
function ApplicationBody() {
  return (
    <div className="flex h-5 items-center">
      <Skeleton className="h-4 w-full max-w-xs" />
    </div>
  );
}
