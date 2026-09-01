import { Boxes, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { ApplicationList } from "@/components/apps/application-list";
import { LOGS_PATH } from "@/components/logs/search-params";
import {
  AccessRefused,
  resolveAccess,
} from "@/components/ui-states/access-refused";
import { CardGridSkeleton } from "@/components/ui-states/card-grid-skeleton";
import { EmptyState } from "@/components/ui-states/empty-state";
import { AppHeader } from "@/components/shell/app-header";
import { Button } from "@/components/ui/button";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";
import { listApplications } from "@/lib/apps/queries";
import { getSessionOrRedirect } from "@/lib/auth/session";
import type { AppSession } from "@/lib/auth/types";

export const metadata: Metadata = {
  title: "Applications",
};

/** Every application that can send logs, and the way in to its ingest keys. */
export default async function ApplicationsPage() {
  const session = await getSessionOrRedirect({ returnPath: "/apps" });

  return (
    <AppShell user={session.user}>
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
      </AppHeader>

      <PageContentWrapper className="px-6 py-8">
        <Suspense fallback={<CardGridSkeleton />}>
          <ApplicationsContent session={session} />
        </Suspense>
      </PageContentWrapper>
    </AppShell>
  );
}

async function ApplicationsContent({ session }: { session: AppSession }) {
  const outcome = await resolveAccess(() => listApplications(session));
  if (!outcome.allowed) return <AccessRefused code={outcome.code} />;

  const applications = outcome.data;

  if (applications.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title="No applications yet"
        description="An application is registered in the database before it can log anything. Once one exists, it will appear here with its ingest keys."
      />
    );
  }

  return <ApplicationList applications={applications} />;
}
