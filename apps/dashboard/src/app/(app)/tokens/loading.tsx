import { AppHeaderSkeleton } from "@/components/shell/app-header-skeleton";
import { ApiTokensSkeleton } from "@/components/tokens/api-tokens-skeleton";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";

/**
 * The API-token page's instant loading state.
 *
 * Safe directly in `tokens/`: there is no child route under it that would
 * need to answer a real 404 status, which is the reason the applications list
 * sits in its own `(list)` group (see `(overview)/loading.tsx`).
 */
export default function ApiTokensLoading() {
  return (
    <>
      <AppHeaderSkeleton />
      <PageContentWrapper className="px-6 py-8">
        <ApiTokensSkeleton />
      </PageContentWrapper>
    </>
  );
}
