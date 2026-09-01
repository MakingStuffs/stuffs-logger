import { cn } from "./utils";

/**
 * A placeholder block drawn while real content loads.
 *
 * Carries no size of its own: the caller gives it the exact footprint of the
 * thing it stands in for, because a placeholder that collapses when the data
 * lands is a layout shift, and layout shift is a defect rather than a
 * cosmetic detail.
 *
 * The pulse is gated behind `motion-safe`, so a reader who has asked for
 * reduced motion gets a still block.
 *
 * @example
 * <Skeleton className="h-4 w-28" />
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-muted rounded-md motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}
