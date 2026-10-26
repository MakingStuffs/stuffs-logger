import { Boxes, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CreateApplicationControl } from "@/components/apps/application-admin-controls";
import { ApplicationList } from "@/components/apps/application-list";
import { ApplicationsEmptyState } from "@/components/apps/applications-empty-state";
import { LOGS_PATH } from "@/components/logs/search-params";
import {
  AccessRefused,
  resolveAccess,
} from "@/components/ui-states/access-refused";
import { CardGridSkeleton } from "@/components/ui-states/card-grid-skeleton";
import { AppHeader } from "@/components/shell/app-header";
import { Button } from "@/components/ui/button";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";
import { listApplications } from "@/lib/apps/queries";
import { isAdminUser } from "@/lib/auth/roles";
import { getSessionOrRedirect } from "@/lib/auth/session";
import type { AppSession } from "@/lib/auth/types";

export const metadata: Metadata = {
  title: "Applications",
};

/**
 * Every application that can send logs, and the way in to its ingest keys.
 *
 * In its own route group so that its `loading.tsx` wraps this page and not
 * `/apps/[slug]` beside it; see `(overview)/loading.tsx` for the reasoning.
 *
 * The "New application" control is rendered for administrators only. That is
 * presentation: `createApplicationAction` re-checks the role itself.
 */
export default async function ApplicationsPage() {
  const session = await getSessionOrRedirect({ returnPath: "/apps" });
  const isAdmin = isAdminUser(session);

  return (
    <>
      <AppHeader
        header="Applications"
        copy="Everything sending logs to Stuffs Logger, and the keys it sends them with."
        icon={Boxes}
      >
        <Button asChild variant="outline" size="sm">
          <Link href={LOGS_PATH} title="Search and filter every log line">
            <ScrollText className="size-4" aria-hidden="true" />
            Open log explorer
          </Link>
        </Button>
        {isAdmin ? <CreateApplicationControl /> : null}
      </AppHeader>

      <PageContentWrapper className="px-6 py-8">
        <Suspense fallback={<CardGridSkeleton variant="application" />}>
          <ApplicationsContent session={session} isAdmin={isAdmin} />
        </Suspense>
      </PageContentWrapper>
    </>
  );
}

async function ApplicationsContent({
  session,
  isAdmin,
}: {
  session: AppSession;
  isAdmin: boolean;
}) {
  const outcome = await resolveAccess(() => listApplications(session));
  if (!outcome.allowed) return <AccessRefused code={outcome.code} />;

  const applications = outcome.data;

  if (applications.length === 0) {
    return <ApplicationsEmptyState isAdmin={isAdmin} />;
  }

  return <ApplicationList applications={applications} />;
}
