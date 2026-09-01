import { AppHeader } from "@journey-further/salient-ui/components/app-header";
import { Button } from "@journey-further/salient-ui/ui/button";
import { PageContentWrapper } from "@journey-further/salient-ui/ui/page-content-wrapper";
import { Boxes, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { IngestKeysSection } from "@/components/apps/ingest-keys-section";
import { applicationLogsHref } from "@/components/logs/search-params";
import {
  AccessRefused,
  resolveAccess,
} from "@/components/ui-states/access-refused";
import { getApplicationBySlug, listIngestKeys } from "@/lib/apps/queries";
import { getSessionOrRedirect } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Application",
};

/**
 * One application: what it is, and the credentials that write into it.
 *
 * THE TWO READS ARE RESOLVED SEPARATELY, because they no longer share a gate.
 * Any live account may see an application; only an administrator may see its
 * ingest keys, which are live write credentials. Resolving them together would
 * mean a MEMBER hitting the key refusal and losing the whole page with it, so
 * the refusal is rendered in the keys section's place instead.
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
      <AppShell user={session.user}>
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
      </AppShell>
    );
  }

  // `notFound` signals by throwing, so the loader returns null for a missing
  // slug and the page raises it out here, clear of the refusal catch.
  if (outcome.data === null) notFound();
  const application = outcome.data;

  // The second, tighter gate. A refusal here is a designed state for this
  // section, not a failure of the page around it.
  const keysOutcome = await resolveAccess(() =>
    listIngestKeys(session, application.id),
  );

  return (
    <AppShell user={session.user}>
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
      </AppHeader>

      <PageContentWrapper className="flex flex-col gap-8 px-6 py-8">
        {keysOutcome.allowed ? (
          <IngestKeysSection
            application={application}
            keys={keysOutcome.data}
          />
        ) : (
          <AccessRefused code={keysOutcome.code} />
        )}
      </PageContentWrapper>
    </AppShell>
  );
}
