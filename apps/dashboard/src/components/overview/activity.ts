import type { ApplicationActivity, ApplicationSummary } from "@/lib/logs/dto";

/**
 * How the overview decides what to show, kept separate from how it looks so
 * the decision can be tested without rendering anything.
 */

/**
 * How far back the overview looks.
 *
 * A day is the window an operator actually asks about — "is anything on fire
 * right now?" — and it is short enough that the grouped aggregates behind it
 * stay cheap.
 */
export const OVERVIEW_WINDOW_HOURS = 24;

/** The overview window in milliseconds. */
export const OVERVIEW_WINDOW_MS = OVERVIEW_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * Above this share of events, an application's error rate is called out.
 *
 * A judgement about presentation, not a threshold anything acts on — it only
 * decides whether the figure is shown in the destructive style.
 */
export const ELEVATED_ERROR_RATE = 0.05;

/** One application's activity, as the overview renders it. */
export interface ApplicationActivityCard {
  applicationId: string;
  applicationSlug: string;
  applicationName: string;
  description: string | null;
  eventCount: number;
  errorCount: number;
}

/**
 * Every known application, with its counts for the window.
 *
 * The activity query only returns applications that HAVE events, which would
 * make a newly registered app invisible on the overview exactly when someone
 * is watching for its first log line. Merging against the full application
 * list means a quiet app shows a deliberate zero instead of nothing at all.
 *
 * @param applications - Every application the viewer can see.
 * @param activity - Counts for the window, for applications that had events.
 * @returns One card per application, busiest first, then alphabetical.
 */
export function mergeApplicationActivity(
  applications: ApplicationSummary[],
  activity: ApplicationActivity[],
): ApplicationActivityCard[] {
  const countsByApplication = new Map(
    activity.map((row) => [row.applicationId, row]),
  );

  return applications
    .map((application) => {
      const counts = countsByApplication.get(application.id);
      return {
        applicationId: application.id,
        applicationSlug: application.slug,
        applicationName: application.name,
        description: application.description,
        eventCount: counts?.eventCount ?? 0,
        errorCount: counts?.errorCount ?? 0,
      };
    })
    .sort(
      (left, right) =>
        right.eventCount - left.eventCount ||
        left.applicationName.localeCompare(right.applicationName),
    );
}

/**
 * Whether an application's error rate deserves attention.
 *
 * @param card - The merged counts for one application.
 * @returns Whether the rate is above {@link ELEVATED_ERROR_RATE}.
 */
export function hasElevatedErrorRate(card: ApplicationActivityCard): boolean {
  if (card.eventCount === 0) return false;
  return card.errorCount / card.eventCount > ELEVATED_ERROR_RATE;
}
