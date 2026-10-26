import { Skeleton } from "../ui/skeleton";

/** Rows drawn while the users load. */
const SKELETON_ROW_COUNT = 4;

/**
 * The users table's loading state: a header row and a few rows of the same
 * height as the real ones (`py-2` cells around `h-8` action buttons), so the
 * table lands without moving the footer.
 */
export function UsersTableSkeleton() {
  return (
    <div className="bg-card rounded-lg border" aria-hidden="true">
      <div className="flex h-10 items-center gap-6 border-b px-3">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-20" />
      </div>
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-6 border-b px-3 py-2 last:border-b-0"
        >
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="ml-auto h-8 w-64 rounded-md" />
        </div>
      ))}
    </div>
  );
}
