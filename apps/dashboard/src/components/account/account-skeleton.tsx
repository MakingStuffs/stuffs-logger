import { Skeleton } from "../ui/skeleton";

/** The three account cards' footprints, while the sign-in methods load. */
export function AccountSkeleton() {
  return (
    <div className="flex max-w-2xl flex-col gap-6" aria-hidden="true">
      <Skeleton className="h-44 w-full rounded-lg" />
      <Skeleton className="h-80 w-full rounded-lg" />
      <Skeleton className="h-36 w-full rounded-lg" />
    </div>
  );
}
