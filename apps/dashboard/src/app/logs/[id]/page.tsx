import { getSessionOrRedirect } from "@journey-further/salient-auth/server";
import { AppHeader } from "@journey-further/salient-ui/components/app-header";
import { Button } from "@journey-further/salient-ui/ui/button";
import { PageContentWrapper } from "@journey-further/salient-ui/ui/page-content-wrapper";
import { ArrowLeft, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { LogDetail } from "@/components/logs/log-detail";
import {
  applicationLogsHref,
  LOGS_PATH,
} from "@/components/logs/search-params";
import { APP_SLUG } from "@/constants/environment";
import { getLogEvent } from "@/lib/logs/queries";

export const metadata: Metadata = {
  title: "Log event",
};

/**
 * One log event in full.
 *
 * A route of its own rather than a panel inside the explorer, because the
 * heavy fields — the context blob, the stack trace, the user agent — are only
 * ever wanted one row at a time, and because a specific event is the thing
 * people paste into a ticket.
 */
export default async function LogEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getSessionOrRedirect(APP_SLUG, {
    returnPath: `/logs/${encodeURIComponent(id)}`,
  });

  const event = await getLogEvent(session, id);
  if (event === null) notFound();

  return (
    <AppShell user={session.user}>
      <AppHeader
        header="Log event"
        copy={`${event.applicationName} · ${event.environment}`}
        icon={ScrollText}
        breadcrumbs={[
          { label: "Log explorer", href: LOGS_PATH },
          {
            label: event.applicationName,
            href: applicationLogsHref(event.applicationSlug),
          },
          { label: "Event" },
        ]}
      >
        <Button asChild variant="outline" size="sm">
          <Link
            href={applicationLogsHref(event.applicationSlug)}
            title={`Back to ${event.applicationName} logs`}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to logs
          </Link>
        </Button>
      </AppHeader>

      <PageContentWrapper className="px-6 py-8">
        <LogDetail event={event} />
      </PageContentWrapper>
    </AppShell>
  );
}
