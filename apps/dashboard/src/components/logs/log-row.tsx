"use client";

import { cn } from "@journey-further/salient-ui/lib";
import { TableCell, TableRow } from "@journey-further/salient-ui/ui/table";
import { ChevronRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Fragment, memo } from "react";

import type { LogEventListItem } from "@/lib/logs/dto";

import {
  DEVICE_LABELS,
  LOGGER_LABELS,
  SOURCE_LABELS,
} from "./filter-vocabulary";
import {
  EMPTY_VALUE,
  formatUtcTimestamp,
  formatUtcTimestampLong,
} from "./format";
import { LogLevelBadge } from "./log-level-badge";
import { toSafeHttpUrl } from "./safe-url";

/** Cells in the summary row — the detail row spans exactly this many. */
export const LOG_TABLE_COLUMN_COUNT = 6;

interface LogRowProps {
  event: LogEventListItem;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}

/**
 * One log line, with an expandable detail panel.
 *
 * Memoised because a full page is 200 rows and toggling one of them must not
 * re-render the other 199: with a single `expandedId` held by the table, only
 * the row opening and the row closing see changed props.
 */
export const LogRow = memo(function LogRow({
  event,
  isExpanded,
  onToggle,
}: LogRowProps) {
  const detailId = `log-detail-${event.id}`;

  return (
    <Fragment>
      <TableRow data-state={isExpanded ? "selected" : undefined}>
        <TableCell className="w-10 py-2 pr-0">
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={detailId}
            onClick={() => onToggle(event.id)}
            className="hover:bg-muted focus-visible:ring-ring inline-flex size-7 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-4 transition-transform motion-reduce:transition-none",
                isExpanded && "rotate-90",
              )}
            />
            <span className="sr-only">
              {isExpanded ? "Hide details for" : "Show details for"} the event
              at {formatUtcTimestamp(event.timestamp)}
            </span>
          </button>
        </TableCell>

        <TableCell
          className="text-muted-foreground py-2 font-mono text-xs whitespace-nowrap"
          title={formatUtcTimestampLong(event.timestamp)}
        >
          {formatUtcTimestamp(event.timestamp)}
        </TableCell>

        <TableCell className="py-2">
          <LogLevelBadge level={event.level} />
        </TableCell>

        <TableCell className="py-2 text-sm whitespace-nowrap">
          {event.applicationName}
        </TableCell>

        <TableCell className="text-muted-foreground py-2 text-sm whitespace-nowrap">
          {event.environment}
        </TableCell>

        <TableCell className="py-2">
          {/* Attacker-controlled text: rendered as a React child, escaped, and
              clamped to one line so a 4KB message cannot blow out the row. */}
          <span className="block max-w-prose truncate font-mono text-xs">
            {event.message}
          </span>
        </TableCell>
      </TableRow>

      {isExpanded ? (
        <TableRow id={detailId} className="hover:bg-transparent">
          <TableCell colSpan={LOG_TABLE_COLUMN_COUNT} className="bg-muted/40">
            <LogRowDetails event={event} />
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
});

function LogRowDetails({ event }: { event: LogEventListItem }) {
  const safeUrl = toSafeHttpUrl(event.url);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
          Message
        </h3>
        <p className="font-mono text-xs break-words whitespace-pre-wrap">
          {event.message}
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Received (UTC)">
          {formatUtcTimestampLong(event.receivedAt)}
        </Detail>
        <Detail label="Source">{SOURCE_LABELS[event.source]}</Detail>
        <Detail label="Logger">{LOGGER_LABELS[event.logger]}</Detail>
        <Detail label="Device">
          {event.deviceType === null
            ? EMPTY_VALUE
            : DEVICE_LABELS[event.deviceType]}
        </Detail>
        <Detail label="Operating system">{event.os ?? EMPTY_VALUE}</Detail>
        <Detail label="Browser">{event.browser ?? EMPTY_VALUE}</Detail>
        <Detail label="Release">{event.release ?? EMPTY_VALUE}</Detail>
        <Detail label="Session">{event.sessionId ?? EMPTY_VALUE}</Detail>
        <Detail label="Error name">{event.errorName ?? EMPTY_VALUE}</Detail>
        <Detail label="Page URL">
          {safeUrl === null ? (
            // Either absent, or a scheme we refuse to put in an href — a
            // `javascript:` URL here would run with the reader's session.
            <span className="break-all">{event.url ?? EMPTY_VALUE}</span>
          ) : (
            <a
              href={safeUrl}
              rel="noreferrer noopener nofollow"
              target="_blank"
              className="hover:text-foreground focus-visible:ring-ring inline-flex items-start gap-1 underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="break-all">{safeUrl}</span>
              <ExternalLink
                className="mt-0.5 size-3 shrink-0"
                aria-hidden="true"
              />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </Detail>
      </dl>

      <div>
        <Link
          href={`/logs/${event.id}`}
          className="text-primary hover:text-primary/80 focus-visible:ring-ring rounded-sm text-xs font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
        >
          {event.hasContext
            ? "View full event, including context"
            : "View full event"}
        </Link>
      </div>
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
      <dt className="text-muted-foreground font-semibold">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}
