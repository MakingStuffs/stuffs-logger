import { LogFiltersSkeleton } from "@/components/logs/log-filters-skeleton";
import { LogTableSkeleton } from "@/components/logs/log-table-skeleton";
import { AppHeaderSkeleton } from "@/components/shell/app-header-skeleton";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";

/**
 * The log explorer's instant loading state.
 *
 * Lives in the `(explorer)` group so that it wraps `/logs` alone. A
 * `loading.tsx` one level up, in `logs/`, would also wrap `/logs/[id]` — and a
 * page inside a loading boundary cannot answer a real 404 status, which that
 * page must for an event that has been removed. The full reasoning is in
 * `(overview)/loading.tsx`.
 *
 * The filters are not known here — this file renders before the URL has been
 * read — so the panel is drawn closed and the table at its default depth.
 */
export default function LogsLoading() {
  return (
    <>
      <AppHeaderSkeleton />
      <PageContentWrapper className="flex flex-col gap-6 px-6 py-8">
        <LogFiltersSkeleton />
        <LogTableSkeleton />
      </PageContentWrapper>
    </>
  );
}
