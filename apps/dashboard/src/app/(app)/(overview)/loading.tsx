import { ApplicationActivitySkeleton } from "@/components/overview/activity-skeleton";
import { AppHeaderSkeleton } from "@/components/shell/app-header-skeleton";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";

/**
 * The overview's instant loading state.
 *
 * WHY THIS PAGE HAS ITS OWN ROUTE GROUP. A `loading.tsx` is a `<Suspense>`
 * boundary around every segment beneath it, and it is what makes a dynamic
 * route prefetchable: the router fetches the layout and this fallback ahead of
 * a click and shows them the instant the click lands. But a boundary also
 * starts the response streaming before the page has run — which means a page
 * inside one can no longer answer with a 404 STATUS, only with a not-found
 * body on a 200. `/apps/[slug]` and `/logs/[id]` must answer a real 404 (the
 * e2e suite pins it), so a `loading.tsx` beside the shared layout would wrap
 * them too and cost them that. Each page that can take a boundary gets one in
 * a group of its own instead; the two that cannot stay bare.
 *
 * Mirrors the page: a header with its two actions, then the summary line and
 * the grid. No heading and no text — this is reserved space, not content.
 */
export default function OverviewLoading() {
  return (
    <>
      <AppHeaderSkeleton actions={2} />
      <PageContentWrapper className="flex flex-col gap-8 px-6 py-8">
        <ApplicationActivitySkeleton />
      </PageContentWrapper>
    </>
  );
}
