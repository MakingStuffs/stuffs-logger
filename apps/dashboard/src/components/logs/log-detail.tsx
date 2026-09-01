import { ExternalLink } from "lucide-react";
import Link from "next/link";

import type { LogEventDetail } from "@/lib/logs/dto";

import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

import {
  DEVICE_LABELS,
  LOGGER_LABELS,
  SOURCE_LABELS,
} from "./filter-vocabulary";
import {
  EMPTY_VALUE,
  formatContext,
  formatStack,
  formatUtcTimestampLong,
} from "./format";
import { LogLevelBadge } from "./log-level-badge";
import { toSafeHttpUrl } from "./safe-url";
import { applicationLogsHref } from "./search-params";
import { TextBlock } from "./text-block";

/**
 * A single event in full.
 *
 * Every string on this page was written by whoever holds an ingest key for the
 * application, which for a browser key is anyone who can read its JavaScript.
 * All of it — message, error text, stack trace, context — is therefore rendered
 * as TEXT: React children and `<pre>` content, never markup, never an `href`
 * without a scheme check.
 */
export function LogDetail({ event }: { event: LogEventDetail }) {
  const safeUrl = toSafeHttpUrl(event.url);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <LogLevelBadge level={event.level} />
            <span className="text-muted-foreground font-mono text-sm">
              {formatUtcTimestampLong(event.timestamp)}
            </span>
          </div>
          <CardTitle className="pt-2 font-mono text-base leading-relaxed break-words">
            {event.message}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Application">
              <Link
                href={applicationLogsHref(event.applicationSlug)}
                className="hover:text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
              >
                {event.applicationName}
              </Link>
            </Detail>
            <Detail label="Environment">{event.environment}</Detail>
            <Detail label="Release">{event.release ?? EMPTY_VALUE}</Detail>
            <Detail label="Source">{SOURCE_LABELS[event.source]}</Detail>
            <Detail label="Logger">{LOGGER_LABELS[event.logger]}</Detail>
            <Detail label="Received (UTC)">
              {formatUtcTimestampLong(event.receivedAt)}
            </Detail>
            <Detail label="Device">
              {event.deviceType === null
                ? EMPTY_VALUE
                : DEVICE_LABELS[event.deviceType]}
            </Detail>
            <Detail label="Operating system">{event.os ?? EMPTY_VALUE}</Detail>
            <Detail label="Browser">{event.browser ?? EMPTY_VALUE}</Detail>
            <Detail label="Session">{event.sessionId ?? EMPTY_VALUE}</Detail>
            <Detail label="Event id">
              <span className="font-mono text-xs break-all">{event.id}</span>
            </Detail>
            <Detail label="Page URL">
              {safeUrl === null ? (
                <span className="break-all">{event.url ?? EMPTY_VALUE}</span>
              ) : (
                <a
                  href={safeUrl}
                  rel="noreferrer noopener nofollow"
                  target="_blank"
                  className="hover:text-foreground focus-visible:ring-ring inline-flex items-start gap-1 rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="break-all">{safeUrl}</span>
                  <ExternalLink
                    className="mt-1 size-3 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
            </Detail>
          </dl>
        </CardContent>
      </Card>

      {event.errorName === null && event.errorStack === null ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Error</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Detail label="Name">{event.errorName ?? EMPTY_VALUE}</Detail>
              <Detail label="Message">
                <span className="break-words">
                  {event.errorMessage ?? EMPTY_VALUE}
                </span>
              </Detail>
            </dl>
            {event.errorStack === null ? null : (
              <TextBlock label="Stack trace">
                {formatStack(event.errorStack)}
              </TextBlock>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Context</CardTitle>
        </CardHeader>
        <CardContent>
          {event.hasContext ? (
            <TextBlock label="Event context, as JSON">
              {formatContext(event.context)}
            </TextBlock>
          ) : (
            <p className="text-muted-foreground text-sm">
              This event was logged without any additional context.
            </p>
          )}
        </CardContent>
      </Card>

      {event.userAgent === null ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">User agent</CardTitle>
          </CardHeader>
          <CardContent>
            <TextBlock label="Reported user agent">{event.userAgent}</TextBlock>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs font-semibold">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
