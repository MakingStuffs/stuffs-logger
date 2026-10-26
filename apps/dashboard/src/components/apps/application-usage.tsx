import type { ApplicationUsageToday } from "@/lib/apps/dto";

import { formatCount } from "../logs/format";
import { cn } from "../ui/utils";

import { formatBytes, percentOfCeiling } from "./usage-format";

/** From here a bar turns amber: close enough to the ceiling to act on. */
const WARNING_PERCENT = 80;

/** At the ceiling, the ingest endpoint refuses further batches. */
const CEILING_PERCENT = 100;

/**
 * Today's ingest volume for one application, against the daily ceilings.
 *
 * Visible to every live account: it says how busy an application is, not how
 * to write to it. Rendered on the server — it is two bars and some text, and
 * has nothing to do in the browser.
 */
export function ApplicationUsage({ usage }: { usage: ApplicationUsageToday }) {
  return (
    <section
      aria-labelledby="usage-heading"
      className="bg-card flex flex-col gap-4 rounded-lg border p-5"
    >
      <div>
        <h2 id="usage-heading" className="text-lg font-semibold">
          Usage today
        </h2>
        <p className="text-muted-foreground text-sm">
          Counted since midnight UTC on {usage.day}. At either ceiling the
          ingest endpoint refuses further batches until the day resets.
        </p>
      </div>

      <UsageBar
        id="usage-events"
        label="Events"
        used={usage.eventCount}
        ceiling={usage.eventQuota}
        format={formatCount}
      />
      <UsageBar
        id="usage-bytes"
        label="Data received"
        used={usage.byteCount}
        ceiling={usage.byteQuota}
        format={formatBytes}
      />
    </section>
  );
}

function UsageBar({
  id,
  label,
  used,
  ceiling,
  format,
}: {
  id: string;
  label: string;
  used: number;
  ceiling: number;
  format: (value: number) => string;
}) {
  const percent = percentOfCeiling(used, ceiling);
  const summary = `${format(used)} of ${format(ceiling)}`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span id={`${id}-label`} className="font-medium">
          {label}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {summary} ({percent}%)
        </span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={`${id}-label`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${summary}, ${percent}% of today's ceiling`}
        className="bg-muted h-2 overflow-hidden rounded-full"
      >
        <div
          className={cn(
            "h-full rounded-full",
            percent >= CEILING_PERCENT
              ? "bg-destructive"
              : percent >= WARNING_PERCENT
                ? "bg-warning"
                : "bg-primary",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      {percent >= CEILING_PERCENT ? (
        <p className="text-destructive text-xs">
          Ceiling reached. New {label.toLowerCase()} are being refused until
          midnight UTC.
        </p>
      ) : null}
    </div>
  );
}
