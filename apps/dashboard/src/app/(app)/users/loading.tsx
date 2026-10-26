import { AppHeaderSkeleton } from "@/components/shell/app-header-skeleton";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";
import { UsersTableSkeleton } from "@/components/users/users-table-skeleton";

/**
 * The users page's instant loading state. Safe to sit directly in `users/`:
 * the route has no children that must answer a 404 status (see
 * `(overview)/loading.tsx` for why that matters).
 */
export default function UsersLoading() {
  return (
    <>
      <AppHeaderSkeleton actions={1} />
      <PageContentWrapper className="px-6 py-8">
        <UsersTableSkeleton />
      </PageContentWrapper>
    </>
  );
}
