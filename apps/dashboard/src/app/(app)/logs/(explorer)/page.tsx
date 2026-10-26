import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FilterIssues } from "@/components/logs/filter-issues";
import { formatUtcTimestampLong } from "@/components/logs/format";
import { LogFiltersPanel } from "@/components/logs/log-filters";
import { LogFiltersSkeleton } from "@/components/logs/log-filters-skeleton";
import { LogPagination } from "@/components/logs/log-pagination";
import { LogTable } from "@/components/logs/log-table";
import { LogTableSkeleton } from "@/components/logs/log-table-skeleton";
import {
  buildLogsHref,
  hasActiveFilters,
  hasSecondaryFilter,
  LOGS_PATH,
  normaliseSearchParams,
} from "@/components/logs/search-params";
import {
  AccessRefused,
  resolveAccess,
} from "@/components/ui-states/access-refused";
import { EmptyState } from "@/components/ui-states/empty-state";
import { AppHeader } from "@/components/shell/app-header";
import { Button } from "@/components/ui/button";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";
import { assertActiveViewer } from "@/lib/access";
import { listApplications } from "@/lib/apps/queries";
import { getSessionOrRedirect } from "@/lib/auth/session";
import type { AppSession } from "@/lib/auth/types";
import type { LogFilters, RawSearchParams } from "@/lib/logs/filters";
import { parseLogFilters, SEARCH_DEFAULT_WINDOW_MS } from "@/lib/logs/filters";
import { listEnvironments, listLogEvents } from "@/lib/logs/queries";

export const metadata: Metadata = {
  title: "Log explorer",
};

/** The default search window, in the unit the note below says it in. */
const SEARCH_DEFAULT_WINDOW_HOURS = SEARCH_DEFAULT_WINDOW_MS / (60 * 60 * 1000);

/**
 * The log explorer.
 *
 * Every filter lives in the URL, which is what makes a view server-rendered,
 * shareable and back-button-correct — and is also why the filter panel needs
 * no JavaScript at all. The query string is entirely attacker-controlled, so
 * it is validated before anything is read, and a rejected URL is a designed
 * state rather than a crash.
 *
 * NOTHING ON THIS PAGE WAITS FOR THE DATABASE BEFORE THE SHELL PAINTS. The
 * session gate and the URL validation are the only things awaited in the page
 * itself; the two reads the filter panel needs and the stream itself each sit
 * in a `<Suspense>` boundary of their own, so the header, the applied-range
 * line and both skeletons are on the wire the moment the session resolves.
 *
 * In its own route group so that its `loading.tsx` wraps this page and not
 * `/logs/[id]` beside it; see `(overview)/loading.tsx` for the reasoning.
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

  const session = await getSessionOrRedirect({
    returnPath: parsed.ok ? buildLogsHref(parsed.filters) : LOGS_PATH,
  });

  if (!parsed.ok) {
    return (
      <>
        <LogsHeader />
        <PageContentWrapper className="px-6 py-8">
          <FilterIssues issues={parsed.issues} />
        </PageContentWrapper>
      </>
    );
  }

  const { filters } = parsed;

  // The access check, run HERE and WITHOUT I/O. Every read below re-checks the
  // session for itself, but those reads are inside streamed boundaries, and a
  // deactivated account is better told once, in the page's own place, than
  // twice from inside two skeletons. `assertActiveViewer` is the same gate
  // the queries use — a pure function of the session — so refusing on it here
  // is the same decision the data layer would make, made before anything is
  // streamed.
  const viewer = await resolveAccess(async () => assertActiveViewer(session));

  if (!viewer.allowed) {
    return (
      <>
        <LogsHeader />
        <PageContentWrapper className="px-6 py-8">
          <AccessRefused code={viewer.code} />
        </PageContentWrapper>
      </>
    );
  }

  return (
    <>
      <LogsHeader />
      <PageContentWrapper className="flex flex-col gap-6 px-6 py-8">
        {/* The panel needs the application list and the environment facet,
            two reads of their own. Its skeleton copies the panel's structure
            — open or closed, as the applied filters decide — so the swap moves
            nothing beneath it. */}
        <Suspense
          fallback={
            <LogFiltersSkeleton expanded={hasSecondaryFilter(filters)} />
          }
        >
          <LogFilterPanel session={session} filters={filters} />
        </Suspense>

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
    </>
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

/**
 * The filter panel, once its two reads have answered.
 *
 * Both reads re-check the session as defence in depth; the page has already
 * refused an inactive account with the same check, so a refusal thrown from
 * here would mean the two had disagreed, which is a bug for the error
 * boundary rather than a state to render.
 */
async function LogFilterPanel({
  session,
  filters,
}: {
  session: AppSession;
  filters: LogFilters;
}) {
  const [applications, environments] = await Promise.all([
    listApplications(session),
    listEnvironments(session, filters.applicationId),
  ]);

  return (
    <LogFiltersPanel
      filters={filters}
      applications={applications}
      environments={environments}
      now={new Date()}
    />
  );
}

/**
 * The time range in force, spelled out.
 *
 * When the lower bound was supplied by the validator rather than the reader —
 * a free-text search with no `from` is bounded to the last day so it cannot
 * scan the whole table — the range is still shown, and a second line says
 * where it came from and how to widen it. Without that line a search that
 * finds nothing older than a day reads as "nothing older exists".
 */
function AppliedRange({ filters }: { filters: LogFilters }) {
  if (filters.from === undefined && filters.to === undefined) return null;

  return (
    <div className="text-muted-foreground flex flex-col gap-1 text-sm">
      <p>
        Showing events
        {filters.from === undefined
          ? ""
          : ` from ${formatUtcTimestampLong(filters.from)}`}
        {filters.to === undefined
          ? ""
          : ` up to ${formatUtcTimestampLong(filters.to)}`}
        .
      </p>
      {filters.fromDefaulted === true ? (
        <p>
          Searches are limited to the last {SEARCH_DEFAULT_WINDOW_HOURS} hours
          unless you set a From date.
        </p>
      ) : null}
    </div>
  );
}

async function LogResults({
  session,
  filters,
}: {
  session: AppSession;
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
