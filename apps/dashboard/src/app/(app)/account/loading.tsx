import { AccountSkeleton } from "@/components/account/account-skeleton";
import { AppHeaderSkeleton } from "@/components/shell/app-header-skeleton";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";

/** The account page's instant loading state. */
export default function AccountLoading() {
  return (
    <>
      <AppHeaderSkeleton />
      <PageContentWrapper className="px-6 py-8">
        <AccountSkeleton />
      </PageContentWrapper>
    </>
  );
}
