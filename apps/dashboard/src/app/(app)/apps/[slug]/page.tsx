import { Boxes, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  ApplicationDangerZone,
  EditApplicationControl,
} from "@/components/apps/application-admin-controls";
import { ApplicationUsage } from "@/components/apps/application-usage";
import { ApplicationUsageSkeleton } from "@/components/apps/application-usage-skeleton";
import { IngestKeysSection } from "@/components/apps/ingest-keys-section";
import { IngestKeysSkeleton } from "@/components/apps/ingest-keys-skeleton";
import { applicationLogsHref } from "@/components/logs/search-params";
import {
  AccessRefused,
  resolveAccess,
} from "@/components/ui-states/access-refused";
import { AppHeader } from "@/components/shell/app-header";
import { Button } from "@/components/ui/button";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";
import {
  getApplicationBySlug,
  getApplicationUsageToday,
  listIngestKeys,
} from "@/lib/apps/queries";
import { isAdminUser } from "@/lib/auth/roles";
import { getSessionOrRedirect } from "@/lib/auth/session";
import type { AppSession } from "@/lib/auth/types";
import type { ApplicationSummary } from "@/lib/logs/dto";

export const metadata: Metadata = {
  title: "Application",
};

/**
 * Seconds this page's work — and every Server Action invoked from it — may
 * run for.
 *
 * Set for `deleteApplicationAction`, which inherits it: its batched event
 * delete is budgeted at 45 s (`APPLICATION_DELETE_TIME_BUDGET_MS`) and needs
 * headroom for the final cascade and the response.
 */
export const maxDuration = 60;

/**
 * One application: what it is, and the credentials that write into it.
 *
 * THE TWO READS ARE RESOLVED SEPARATELY, because they do not share a gate.
 * Any live account may see an application; only an administrator may see its
 * ingest keys, which are live write credentials. Resolving them together would
 * mean a MEMBER hitting the key refusal and losing the whole page with it, so
 * the refusal is rendered in the keys section's place instead — and the keys
 * are streamed, so the page's own header and copy paint before the second
 * query has answered.
 *
 * NO `loading.tsx` ABOVE THIS PAGE, DELIBERATELY. A missing slug must answer
 * with a 404 STATUS, and a status can only be set while the response is still
 * unsent. A loading boundary would start streaming the shell before the
 * lookup below had resolved, and `notFound()` would then only be able to
 * change the body. That is also why the lookup is awaited here, above the
 * `<Suspense>` for the keys, rather than inside it.
 *
 * ADMIN CONTROLS — "Edit details" and the "Danger zone" — render only for an
 * administrator. That is presentation: both actions re-check the role.
 */
export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await getSessionOrRedirect({
    returnPath: `/apps/${encodeURIComponent(slug)}`,
  });

  const outcome = await resolveAccess(() =>
    getApplicationBySlug(session, slug),
  );

  if (!outcome.allowed) {
    return (
      <>
        <AppHeader
          header="Application"
          copy="An application that sends logs to Stuffs Logger."
          icon={Boxes}
          breadcrumbs={[
            { label: "Applications", href: "/apps" },
            { label: "Application" },
          ]}
        />
        <PageContentWrapper className="px-6 py-8">
          <AccessRefused code={outcome.code} />
        </PageContentWrapper>
      </>
    );
  }

  // `notFound` signals by throwing, so the loader returns null for a missing
  // slug and the page raises it out here, clear of the refusal catch.
  if (outcome.data === null) notFound();
  const application = outcome.data;
  const isAdmin = isAdminUser(session);

  return (
    <>
      <AppHeader
        header={application.name}
        copy={application.description ?? "No description has been set."}
        icon={Boxes}
        breadcrumbs={[
          { label: "Applications", href: "/apps" },
          { label: application.name },
        ]}
      >
        <Button asChild variant="outline" size="sm">
          <Link
            href={applicationLogsHref(application.slug)}
            title={`Logs for ${application.name}`}
          >
            <ScrollText className="size-4" aria-hidden="true" />
            View logs
          </Link>
        </Button>
        {isAdmin ? <EditApplicationControl application={application} /> : null}
      </AppHeader>

      <PageContentWrapper className="flex flex-col gap-8 px-6 py-8">
        <Suspense fallback={<ApplicationUsageSkeleton />}>
          <UsageToday session={session} application={application} />
        </Suspense>
        <Suspense fallback={<IngestKeysSkeleton />}>
          <IngestKeys session={session} application={application} />
        </Suspense>
        {isAdmin ? <ApplicationDangerZone application={application} /> : null}
      </PageContentWrapper>
    </>
  );
}

/** Today's ingest volume: a read any live account may make, streamed in. */
async function UsageToday({
  session,
  application,
}: {
  session: AppSession;
  application: ApplicationSummary;
}) {
  const outcome = await resolveAccess(() =>
    getApplicationUsageToday(session, application.id),
  );
  if (!outcome.allowed) return <AccessRefused code={outcome.code} />;

  return <ApplicationUsage usage={outcome.data} />;
}

/**
 * The second, tighter gate. A refusal here is a designed state for this
 * section, not a failure of the page around it.
 */
async function IngestKeys({
  session,
  application,
}: {
  session: AppSession;
  application: ApplicationSummary;
}) {
  const outcome = await resolveAccess(() =>
    listIngestKeys(session, application.id),
  );
  if (!outcome.allowed) return <AccessRefused code={outcome.code} />;

  return <IngestKeysSection application={application} keys={outcome.data} />;
}
