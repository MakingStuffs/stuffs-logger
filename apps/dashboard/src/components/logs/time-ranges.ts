/**
 * The quick ranges the explorer offers above the date fields.
 *
 * Each one is turned into an ABSOLUTE instant on the server before it reaches
 * a link, so the resulting URL means the same thing to everyone who opens it —
 * unlike a relative token such as `24h`, which would drift every time the page
 * was reloaded and could never be shared as a snapshot.
 */

/** One minute in milliseconds. */
const MINUTE_MS = 60_000;

/** A selectable window, expressed as a distance back from now. */
export interface QuickRange {
  /** Sentence-case label, as shown on the link. */
  label: string;
  /** How far back the window starts, in minutes. */
  minutes: number;
}

/** Windows an operator triages by, shortest first. */
export const QUICK_RANGES: readonly QuickRange[] = [
  { label: "Last hour", minutes: 60 },
  { label: "Last 6 hours", minutes: 6 * 60 },
  { label: "Last 24 hours", minutes: 24 * 60 },
  { label: "Last 7 days", minutes: 7 * 24 * 60 },
  { label: "Last 30 days", minutes: 30 * 24 * 60 },
];

/**
 * The instant a quick range starts at.
 *
 * @param now - The reference instant, passed in so callers stay testable.
 * @param minutes - How far back the window reaches.
 * @returns The absolute lower bound of the window.
 */
export function quickRangeStart(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * MINUTE_MS);
}
