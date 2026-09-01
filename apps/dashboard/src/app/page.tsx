import { getSessionOrRedirect } from "@journey-further/salient-auth/server";
import type { SalientSession } from "@journey-further/salient-auth/server";
import { AppHeader } from "@journey-further/salient-ui/components/app-header";
import { Button } from "@journey-further/salient-ui/ui/button";
import { PageContentWrapper } from "@journey-further/salient-ui/ui/page-content-wrapper";
import { Boxes, LayoutDashboard, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { formatCount } from "@/components/logs/format";
import { LOGS_PATH } from "@/components/logs/search-params";
import {
  OVERVIEW_WINDOW_HOURS,
  OVERVIEW_WINDOW_MS,
} from "@/components/overview/activity";
import { ApplicationActivityCards } from "@/components/overview/application-activity-cards";
import { CardGridSkeleton } from "@/components/ui-states/card-grid-skeleton";
import { EmptyState } from "@/components/ui-states/empty-state";
import { APP_SLUG } from "@/constants/environment";
import { listApplications } from "@/lib/apps/queries";
import { getApplicationActivity } from "@/lib/logs/queries";

export const metadata: Metadata = {
  title: "Overview",
};

/**
 * The overview: how much every application logged in the last day, and how
 * much of it went wrong.
 *
 * Gated per PAGE with `getSessionOrRedirect`, not in the layout — a layout
 * check does not re-run on client-side navigation, so it is a convenience
 * rather than a boundary. The call redirects by throwing, so it is never
 * wrapped in a try/catch.
 */
export default async function OverviewPage() {
  const session = await getSessionOrRedirect(APP_SLUG, { returnPath: "/" });

  return (
    <AppShell user={session.user}>
      <AppHeader
        header="Overview"
        copy={`Every application's activity over the last ${OVERVIEW_WINDOW_HOURS} hours.`}
        icon={LayoutDashboard}
      >
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={LOGS_PATH} title="Search and filter every log line">
              <ScrollText className="size-4" aria-hidden="true" />
              Open log explorer
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/apps" title="Applications and their ingest keys">
              <Boxes className="size-4" aria-hidden="true" />
              Applications
            </Link>
          </Button>
        </div>
      </AppHeader>

      <PageContentWrapper className="flex flex-col gap-8 px-6 py-8">
        {/* The counts are two grouped aggregates over the last day; streaming
            them keeps the shell and its navigation interactive while they run,
            and the skeleton holds the grid's height so nothing jumps. */}
        <Suspense fallback={<CardGridSkeleton />}>
          <OverviewContent session={session} />
        </Suspense>
      </PageContentWrapper>
    </AppShell>
  );
}

async function OverviewContent({ session }: { session: SalientSession }) {
  const to = new Date();
  const from = new Date(to.getTime() - OVERVIEW_WINDOW_MS);

  const [applications, activity] = await Promise.all([
    listApplications(session),
    getApplicationActivity(session, { from, to }),
  ]);

  if (applications.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title="No applications yet"
        description="Once an application is registered and given an ingest key, its log volume and error rate will appear here."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/apps">Go to applications</Link>
          </Button>
        }
      />
    );
  }

  const totalEvents = activity.reduce((sum, row) => sum + row.eventCount, 0);
  const totalErrors = activity.reduce((sum, row) => sum + row.errorCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        {formatCount(totalEvents)} {totalEvents === 1 ? "event" : "events"}{" "}
        received in the last {OVERVIEW_WINDOW_HOURS} hours,{" "}
        {formatCount(totalErrors)} of them at error or fatal.
      </p>
      <ApplicationActivityCards
        applications={applications}
        activity={activity}
      />
    </div>
  );
}
