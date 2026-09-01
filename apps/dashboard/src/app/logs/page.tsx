import { getSessionOrRedirect } from "@journey-further/salient-auth/server";
import type { SalientSession } from "@journey-further/salient-auth/server";
import { AppHeader } from "@journey-further/salient-ui/components/app-header";
import { Button } from "@journey-further/salient-ui/ui/button";
import { PageContentWrapper } from "@journey-further/salient-ui/ui/page-content-wrapper";
import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { FilterIssues } from "@/components/logs/filter-issues";
import { formatUtcTimestampLong } from "@/components/logs/format";
import { LogFiltersPanel } from "@/components/logs/log-filters";
import { LogPagination } from "@/components/logs/log-pagination";
import { LogTable } from "@/components/logs/log-table";
import { LogTableSkeleton } from "@/components/logs/log-table-skeleton";
import {
  buildLogsHref,
  hasActiveFilters,
  LOGS_PATH,
  normaliseSearchParams,
} from "@/components/logs/search-params";
import { EmptyState } from "@/components/ui-states/empty-state";
import { APP_SLUG } from "@/constants/environment";
import { listApplications } from "@/lib/apps/queries";
import type { LogFilters, RawSearchParams } from "@/lib/logs/filters";
import { parseLogFilters } from "@/lib/logs/filters";
import { listEnvironments, listLogEvents } from "@/lib/logs/queries";

export const metadata: Metadata = {
  title: "Log explorer",
};

/**
 * The log explorer.
 *
 * Every filter lives in the URL, which is what makes a view server-rendered,
 * shareable and back-button-correct — and is also why the filter panel needs
 * no JavaScript at all. The query string is entirely attacker-controlled, so
 * it is validated before anything is read, and a rejected URL is a designed
 * state rather than a crash.
 */
export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  // Blank values are stripped first: a native GET form submits every control
  // it owns, so an untouched search box arrives as `?search=` and would
  // otherwise be reported as an invalid filter.
  const parsed = parseLogFilters(normaliseSearchParams(await searchParams));

  const session = await getSessionOrRedirect(APP_SLUG, {
    returnPath: parsed.ok ? buildLogsHref(parsed.filters) : LOGS_PATH,
  });

  if (!parsed.ok) {
    return (
      <AppShell user={session.user}>
        <LogsHeader />
        <PageContentWrapper className="px-6 py-8">
          <FilterIssues issues={parsed.issues} />
        </PageContentWrapper>
      </AppShell>
    );
  }

  const { filters } = parsed;
  const [applications, environments] = await Promise.all([
    listApplications(session),
    listEnvironments(session, filters.applicationId),
  ]);

  return (
    <AppShell user={session.user}>
      <LogsHeader />
      <PageContentWrapper className="flex flex-col gap-6 px-6 py-8">
        <LogFiltersPanel
          filters={filters}
          applications={applications}
          environments={environments}
          now={new Date()}
        />

        <AppliedRange filters={filters} />

        {/* The stream is the slow part of the page. Streaming it means the
            filters are usable the moment the shell paints, and the skeleton
            reserves the table's real footprint so nothing jumps when the rows
            arrive. Keyed by the filters so a new query shows the skeleton
            again rather than the previous page's rows. */}
        <Suspense
          key={buildLogsHref(filters)}
          fallback={<LogTableSkeleton rows={filters.limit} />}
        >
          <LogResults session={session} filters={filters} />
        </Suspense>
      </PageContentWrapper>
    </AppShell>
  );
}

function LogsHeader() {
  return (
    <AppHeader
      header="Log explorer"
      copy="Search and filter every log line from every application."
      icon={ScrollText}
    />
  );
}

function AppliedRange({ filters }: { filters: LogFilters }) {
  if (filters.from === undefined && filters.to === undefined) return null;

  return (
    <p className="text-muted-foreground text-sm">
      Showing events
      {filters.from === undefined
        ? ""
        : ` from ${formatUtcTimestampLong(filters.from.toISOString())}`}
      {filters.to === undefined
        ? ""
        : ` up to ${formatUtcTimestampLong(filters.to.toISOString())}`}
      .
    </p>
  );
}

async function LogResults({
  session,
  filters,
}: {
  session: SalientSession;
  filters: LogFilters;
}) {
  const page = await listLogEvents(session, filters);

  if (page.items.length === 0) {
    return hasActiveFilters(filters) ? (
      <EmptyState
        icon={ScrollText}
        title="No events match these filters"
        description="Nothing was logged in this slice. Widen the time range, or clear the filters to see everything."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={LOGS_PATH}>Clear filters</Link>
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={ScrollText}
        title="No logs yet"
        description="Nothing has been ingested so far. Once an application is sending events with a valid ingest key, its log lines will appear here within seconds."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/apps">Set up an application</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <LogTable events={page.items} />
      <LogPagination filters={filters} page={page} />
    </div>
  );
}
