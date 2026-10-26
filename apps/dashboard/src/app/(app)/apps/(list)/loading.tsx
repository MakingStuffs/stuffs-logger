import { AppHeaderSkeleton } from "@/components/shell/app-header-skeleton";
import { CardGridSkeleton } from "@/components/ui-states/card-grid-skeleton";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";

/**
 * The applications list's instant loading state.
 *
 * Lives in the `(list)` group so that it wraps `/apps` alone. A `loading.tsx`
 * one level up, in `apps/`, would also wrap `/apps/[slug]` — and a page inside
 * a loading boundary cannot answer a real 404 status, which that page must.
 * The full reasoning is in `(overview)/loading.tsx`.
 */
export default function ApplicationsLoading() {
  return (
    <>
      <AppHeaderSkeleton actions={1} />
      <PageContentWrapper className="px-6 py-8">
        <CardGridSkeleton variant="application" />
      </PageContentWrapper>
    </>
  );
}
