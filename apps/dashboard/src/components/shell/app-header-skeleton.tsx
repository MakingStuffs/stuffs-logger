import { Skeleton } from "../ui/skeleton";

/**
 * The page header's loading state.
 *
 * Mirrors {@link AppHeader}'s box model — the icon tile, a title line and a
 * line of copy, and an optional bar of page actions — so the real header lands
 * in exactly the space the placeholder held. Not sticky and not blurred: it is
 * on screen for a moment, and nothing scrolls beneath it in that time.
 *
 * @param actions - How many action buttons the page's header will carry, so
 *   the bar is reserved only on pages that have one.
 */
export function AppHeaderSkeleton({ actions = 0 }: { actions?: number }) {
  return (
    <div aria-hidden="true">
      <div className="flex flex-col gap-2 border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 shrink-0 rounded-md" />
          <div className="flex min-w-0 flex-col gap-0.5">
            {/* The `<h1>` is `text-base` (a 24px line) over `text-xs` copy. */}
            <div className="flex h-6 items-center">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
          </div>
        </div>
      </div>

      {actions === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
          {Array.from({ length: actions }, (_, index) => (
            <Skeleton key={index} className="h-8 w-36 rounded-md" />
          ))}
        </div>
      )}
    </div>
  );
}
