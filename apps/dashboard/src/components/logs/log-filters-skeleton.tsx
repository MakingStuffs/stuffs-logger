import { Skeleton } from "../ui/skeleton";

/** Chips drawn in each facet, roughly what the real vocabularies hold. */
const CHIP_COUNTS = {
  level: 6,
  source: 2,
  device: 5,
  environment: 3,
} as const;

/** Quick-range links drawn in the nav: "All time" plus the preset ranges. */
const QUICK_RANGE_COUNT = 5;

/**
 * The filter panel's loading state.
 *
 * The panel is streamed — its application and environment lists are two
 * database reads — so the shell paints with this in its place and the real
 * panel swaps in. The swap must move nothing beneath it, which is why this is
 * not a grey box of about the right size but a copy of the panel's structure:
 * the same grid, the same column spans, a label line and a control in each
 * field, a chip row per facet. Every height is the real control's own.
 *
 * @param expanded - Whether the "More filters" section will open on render —
 *   it does when one of its filters is applied — so the closed and the open
 *   panel each get a placeholder of their own height.
 */
export function LogFiltersSkeleton({
  expanded = false,
}: {
  expanded?: boolean;
}) {
  return (
    <div className="bg-card rounded-lg border p-4" aria-hidden="true">
      <div className="mb-4 flex flex-wrap gap-2">
        {Array.from({ length: QUICK_RANGE_COUNT }, (_, index) => (
          <ChipSkeleton key={index} />
        ))}
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FieldSkeleton />
          <FieldSkeleton className="sm:col-span-2" />
          <FieldSkeleton />
          <FieldSkeleton />
          <FieldSkeleton />
        </div>

        <FacetSkeleton chips={CHIP_COUNTS.level} />

        {/* The `<summary>` line: `text-sm`, 20px. */}
        <div className="flex h-5 items-center">
          <Skeleton className="h-4 w-56" />
        </div>

        {expanded ? (
          <div className="flex flex-col gap-4">
            <FacetSkeleton chips={CHIP_COUNTS.source} />
            <FacetSkeleton chips={CHIP_COUNTS.device} />
            <FacetSkeleton chips={CHIP_COUNTS.environment} />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </div>
    </div>
  );
}

/** A labelled control: a `leading-none` `text-sm` label over an `h-9` field. */
function FieldSkeleton({ className }: { className?: string }) {
  return (
    <div className={["flex flex-col gap-1.5", className ?? ""].join(" ")}>
      <div className="flex h-3.5 items-center">
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  );
}

/** A facet: a `leading-none` legend with `mb-2`, then a row of chips. */
function FacetSkeleton({ chips }: { chips: number }) {
  return (
    <div className="flex flex-col">
      <div className="mb-2 flex h-3.5 items-center">
        <Skeleton className="h-3 w-12" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: chips }, (_, index) => (
          <ChipSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

/**
 * A chip's footprint: `text-xs` inside `py-1` and a 1px border, 26px tall. The
 * border is drawn transparent so the height is the chip's without a second
 * outline competing with the skeleton's own fill.
 */
function ChipSkeleton() {
  return (
    <div className="inline-flex rounded-full border border-transparent px-3 py-1">
      <Skeleton className="h-4 w-12 rounded-full" />
    </div>
  );
}
