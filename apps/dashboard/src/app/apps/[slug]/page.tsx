import { getSessionOrRedirect } from "@journey-further/salient-auth/server";
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
import { APP_SLUG } from "@/constants/environment";
import { getApplicationBySlug, listIngestKeys } from "@/lib/apps/queries";

export const metadata: Metadata = {
  title: "Application",
};

/**
 * One application: what it is, and the credentials that write into it.
 *
 * Both reads — the application and its keys — are gated on internal staff, so
 * they are resolved together: a caller who may see the application may see its
 * keys, and a caller who may not sees the refusal state instead of an error
 * page.
 */
export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await getSessionOrRedirect(APP_SLUG, {
    returnPath: `/apps/${encodeURIComponent(slug)}`,
  });

  const outcome = await resolveAccess(async () => {
    const application = await getApplicationBySlug(session, slug);
    if (application === null) return null;

    return { application, keys: await listIngestKeys(session, application.id) };
  });

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
  const { application, keys } = outcome.data;

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
        <IngestKeysSection application={application} keys={keys} />
      </PageContentWrapper>
    </AppShell>
  );
}
