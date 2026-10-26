import { Skeleton } from "../ui/skeleton";

/**
 * The usage section's loading state: the heading block over two labelled
 * bars, at the heights the real section draws them.
 */
export function ApplicationUsageSkeleton() {
  return (
    <div
      className="bg-card flex flex-col gap-4 rounded-lg border p-5"
      aria-hidden="true"
    >
      <div className="flex flex-col">
        <div className="flex h-7 items-center">
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-80 max-w-full" />
        </div>
      </div>
      {[0, 1].map((bar) => (
        <div key={bar} className="flex flex-col gap-1.5">
          <div className="flex h-5 items-center justify-between">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3.5 w-36" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}
