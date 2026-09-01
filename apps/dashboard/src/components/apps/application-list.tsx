import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@journey-further/salient-ui/ui/card";
import Link from "next/link";

import type { ApplicationSummary } from "@/lib/logs/dto";

import { formatUtcTimestampLong } from "../logs/format";
import { applicationLogsHref } from "../logs/search-params";

/** Every registered application, as a grid of cards. */
export function ApplicationList({
  applications,
}: {
  applications: ApplicationSummary[];
}) {
  return (
    <ul className="grid list-none gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {applications.map((application) => (
        <li key={application.id}>
          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle className="text-base">
                <Link
                  href={`/apps/${application.slug}`}
                  className="hover:text-primary focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  {application.name}
                </Link>
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                {application.slug}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <p className="text-muted-foreground text-sm">
                {application.description ??
                  "No description has been set for this application."}
              </p>
            </CardContent>
            <CardFooter className="flex flex-wrap items-center gap-4 text-sm">
              <Link
                href={applicationLogsHref(application.slug)}
                aria-label={`View logs for ${application.name}`}
                className="hover:text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
              >
                View logs
              </Link>
              <span className="text-muted-foreground text-xs">
                Added {formatUtcTimestampLong(application.createdAt)}
              </span>
            </CardFooter>
          </Card>
        </li>
      ))}
    </ul>
  );
}
