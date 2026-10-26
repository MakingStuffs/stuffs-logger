import { Boxes, LayoutDashboard, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { formatCount } from "@/components/logs/format";
import { LOGS_PATH } from "@/components/logs/search-params";
import {
  OVERVIEW_WINDOW_HOURS,
  OVERVIEW_WINDOW_MS,
} from "@/components/overview/activity";
import { ApplicationActivitySkeleton } from "@/components/overview/activity-skeleton";
import { ApplicationActivityCards } from "@/components/overview/application-activity-cards";
import {
  AccessRefused,
  resolveAccess,
} from "@/components/ui-states/access-refused";
import type { AccessOutcome } from "@/components/ui-states/access-refused";
import { EmptyState } from "@/components/ui-states/empty-state";
import { AppHeader } from "@/components/shell/app-header";
import { Button } from "@/components/ui/button";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";
import { listApplications } from "@/lib/apps/queries";
import { getSessionOrRedirect } from "@/lib/auth/session";
import type { AppSession } from "@/lib/auth/types";
import type { ApplicationActivity, ApplicationSummary } from "@/lib/logs/dto";
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
 *
 * This page sits in its own route group so that its `loading.tsx` wraps it
 * and nothing else; see that file for why.
 */
export default async function OverviewPage() {
  const session = await getSessionOrRedirect({ returnPath: "/" });

  return (
    <>
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
        {/* Streaming keeps the shell and its navigation interactive while the
            reads run, and the skeleton holds the grid's height so nothing
            jumps. */}
        <Suspense fallback={<ApplicationActivitySkeleton />}>
          <OverviewContent session={session} />
        </Suspense>
      </PageContentWrapper>
    </>
  );
}

/**
 * The application list, with the activity counts streamed in beneath it.
 *
 * The two reads are STARTED TOGETHER and AWAITED SEPARATELY. The application
 * list is a small table read; the counts are two grouped aggregates over a
 * day of events and the slow part of the page. Starting both at once keeps
 * them overlapping as `Promise.all` did, while awaiting only the list here
 * means the grid's skeleton can be sized to the number of cards that will
 * actually land — and an install with no applications shows its empty state
 * without waiting for an aggregate it will never render.
 */
async function OverviewContent({ session }: { session: AppSession }) {
  const to = new Date();
  const from = new Date(to.getTime() - OVERVIEW_WINDOW_MS);

  const activity = resolveAccess(() =>
    getApplicationActivity(session, { from, to }),
  );
  // Marks the promise as handled WITHOUT consuming its result. When this
  // component returns early — refused, or no applications — nothing awaits it,
  // and a rejection left unobserved would be an unhandled-rejection crash
  // rather than a problem for the error boundary. `ActivityCards` still awaits
  // the original and still surfaces the failure on the paths that render it.
  void activity.catch(() => undefined);

  // Refuses a non-internal session by throwing. That refusal is a state this
  // page renders, not a failure for the error boundary.
  const outcome = await resolveAccess(() => listApplications(session));
  if (!outcome.allowed) return <AccessRefused code={outcome.code} />;

  const applications = outcome.data;

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

  return (
    <Suspense
      fallback={<ApplicationActivitySkeleton count={applications.length} />}
    >
      <ActivityCards applications={applications} activity={activity} />
    </Suspense>
  );
}

async function ActivityCards({
  applications,
  activity,
}: {
  applications: ApplicationSummary[];
  activity: Promise<AccessOutcome<ApplicationActivity[]>>;
}) {
  const outcome = await activity;
  if (!outcome.allowed) return <AccessRefused code={outcome.code} />;

  const rows = outcome.data;
  const totalEvents = rows.reduce((sum, row) => sum + row.eventCount, 0);
  const totalErrors = rows.reduce((sum, row) => sum + row.errorCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        {formatCount(totalEvents)} {totalEvents === 1 ? "event" : "events"}{" "}
        received in the last {OVERVIEW_WINDOW_HOURS} hours,{" "}
        {formatCount(totalErrors)} of them at error or fatal.
      </p>
      <ApplicationActivityCards applications={applications} activity={rows} />
    </div>
  );
}
