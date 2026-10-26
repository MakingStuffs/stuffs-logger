import { Clock } from "lucide-react";

import { RETENTION_MIN_RUN_INTERVAL_MS } from "@/constants/retention";

/** Milliseconds in an hour, for wording the throttle. */
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * The throttle as a phrase, derived from the constant the route enforces so
 * the copy cannot drift from the behaviour.
 *
 * @param intervalMs - The minimum gap between accepted runs.
 * @returns e.g. `"once an hour"`, `"once every 6 hours"`.
 */
export function describeRunInterval(intervalMs: number): string {
  const hours = intervalMs / ONE_HOUR_MS;
  if (hours === 1) return "once an hour";
  if (Number.isInteger(hours)) return `once every ${hours} hours`;

  return `once every ${Math.round(intervalMs / 60_000)} minutes`;
}

/**
 * What API tokens are for, on the page that mints them.
 *
 * Today one endpoint consumes them, so the page says exactly which one and how
 * it is called rather than leaving an operator to find out from the docs.
 */
export function RetentionJobNote() {
  return (
    <aside
      aria-labelledby="retention-job-heading"
      className="bg-muted/40 flex gap-3 rounded-lg border p-4 text-sm"
    >
      <Clock
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <div className="flex flex-col gap-1.5">
        <h2 id="retention-job-heading" className="font-semibold">
          What uses these tokens
        </h2>
        <p className="text-muted-foreground">
          The retention job,{" "}
          <code className="font-mono text-xs">GET /api/cron/retention</code>,
          which deletes events older than the retention window. On Vercel it
          runs daily at 03:00 UTC from{" "}
          <code className="font-mono text-xs">vercel.json</code> and sends the
          deployment&rsquo;s CRON_SECRET; anywhere else, any scheduler can call
          it with{" "}
          <code className="font-mono text-xs">
            Authorization: Bearer &lt;token&gt;
          </code>
          .
        </p>
        <p className="text-muted-foreground">
          A token is accepted at most{" "}
          {describeRunInterval(RETENTION_MIN_RUN_INTERVAL_MS)}; a second call
          inside that window answers 429.
        </p>
      </div>
    </aside>
  );
}
