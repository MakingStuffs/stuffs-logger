import { ERROR_LEVELS } from "@jf-logger/core";
import { Badge } from "@journey-further/salient-ui/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@journey-further/salient-ui/ui/card";
import Link from "next/link";

import type { ApplicationActivity, ApplicationSummary } from "@/lib/logs/dto";

import { formatCount, formatErrorRate } from "../logs/format";
import { applicationLogsHref } from "../logs/search-params";

import {
  hasElevatedErrorRate,
  mergeApplicationActivity,
  type ApplicationActivityCard,
} from "./activity";

/**
 * The overview grid: one card per application, busiest first.
 *
 * Each card is a jumping-off point rather than a dashboard in itself — the
 * numbers say whether an application needs attention, and both links land in
 * the explorer already filtered, so triage is one click rather than a filter
 * form.
 */
export function ApplicationActivityCards({
  applications,
  activity,
}: {
  applications: ApplicationSummary[];
  activity: ApplicationActivity[];
}) {
  const cards = mergeApplicationActivity(applications, activity);

  return (
    <ul className="grid list-none gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <li key={card.applicationId}>
          <ApplicationCard card={card} />
        </li>
      ))}
    </ul>
  );
}

function ApplicationCard({ card }: { card: ApplicationActivityCard }) {
  const isElevated = hasElevatedErrorRate(card);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="text-base">{card.applicationName}</CardTitle>
        <CardDescription className="font-mono text-xs">
          {card.applicationSlug}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1">
        <dl className="grid grid-cols-3 gap-4">
          <Metric label="Events" value={formatCount(card.eventCount)} />
          <Metric label="Errors" value={formatCount(card.errorCount)} />
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground text-xs font-semibold">
              Error rate
            </dt>
            <dd>
              <Badge variant={isElevated ? "destructive" : "outline"}>
                {formatErrorRate(card.errorCount, card.eventCount)}
              </Badge>
            </dd>
          </div>
        </dl>
      </CardContent>

      <CardFooter className="flex gap-4 text-sm">
        <Link
          href={applicationLogsHref(card.applicationSlug)}
          aria-label={`View logs for ${card.applicationName}`}
          className="hover:text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
        >
          View logs
        </Link>
        {card.errorCount === 0 ? null : (
          <Link
            href={applicationLogsHref(card.applicationSlug, ERROR_LEVELS)}
            aria-label={`View errors for ${card.applicationName}`}
            className="hover:text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
          >
            View errors
          </Link>
        )}
      </CardFooter>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs font-semibold">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
