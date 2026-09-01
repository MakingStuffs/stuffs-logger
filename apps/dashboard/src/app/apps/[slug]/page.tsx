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
import type { IngestKeyAccess } from "@/components/apps/ingest-keys-section";
import { applicationLogsHref } from "@/components/logs/search-params";
import { APP_SLUG } from "@/constants/environment";
import { isApiError } from "@/lib/api/errors";
import { getApplicationBySlug, listIngestKeys } from "@/lib/apps/queries";
import type { SalientSession } from "@journey-further/salient-auth/server";

export const metadata: Metadata = {
  title: "Application",
};

/**
 * One application: what it is, and the credentials that write into it.
 *
 * Anyone who can read logs can see the application. Key management is narrower
 * — an ingest key is a write credential — so the data layer refuses it for
 * non-internal callers and this page shows that refusal as a state rather than
 * an error page.
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

  const application = await getApplicationBySlug(session, slug);
  if (application === null) notFound();

  const access = await resolveIngestKeyAccess(session, application.id);

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
        <IngestKeysSection application={application} access={access} />
      </PageContentWrapper>
    </AppShell>
  );
}

/**
 * Resolves the key list, turning the data layer's refusal into a state.
 *
 * `listIngestKeys` throws `FORBIDDEN` for a non-internal caller. That is the
 * correct behaviour for a data-access function — it must not quietly return an
 * empty list, which would read as "no keys exist" — but on a page it is an
 * outcome to render, not a 500.
 */
async function resolveIngestKeyAccess(
  session: SalientSession,
  applicationId: string,
): Promise<IngestKeyAccess> {
  try {
    return {
      allowed: true,
      keys: await listIngestKeys(session, applicationId),
    };
  } catch (error) {
    if (isApiError(error) && error.code === "FORBIDDEN") {
      return { allowed: false, message: error.message };
    }
    throw error;
  }
}
