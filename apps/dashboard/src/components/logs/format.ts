/**
 * Presentation-only formatting for log data.
 *
 * Two rules shape everything here. First, every function is DETERMINISTIC —
 * the same input renders identically on the server and in the browser, so a
 * table streamed as HTML and then hydrated cannot disagree with itself. That
 * rules out local-timezone formatting and `Date.now()`-relative phrasing.
 *
 * Second, nothing here produces markup. The values being formatted are
 * attacker-controlled; they are returned as strings for React to escape.
 */

/** Month names, so formatting never depends on the runtime's locale data. */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Shown wherever a value is missing, so a column never renders as a gap. */
export const EMPTY_VALUE = "—";

/**
 * How much of a context blob is rendered before it is cut off.
 *
 * A single event may legitimately carry kilobytes of context, and the ingest
 * endpoint caps the payload rather than the field. Rendering an unbounded
 * string would let one row lock up the browser's layout.
 */
export const MAX_CONTEXT_CHARS = 20_000;

/** Appended when a value was cut off, so truncation is never silent. */
const TRUNCATION_NOTICE = "\n… truncated for display";

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function toValidDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A timestamp as `15 Jan 09:31:04`, in UTC.
 *
 * UTC rather than the viewer's timezone because the same value is rendered on
 * the server and re-rendered in the browser: a local format would produce two
 * different strings whenever those clocks disagree. Every surface that shows a
 * time labels it, so there is no ambiguity for the reader.
 *
 * @param iso - An ISO-8601 instant from a DTO.
 * @returns The formatted instant, or a placeholder when unparseable.
 */
export function formatUtcTimestamp(iso: string): string {
  const date = toValidDate(iso);
  if (date === null) return EMPTY_VALUE;

  const month = MONTHS[date.getUTCMonth()] ?? "";
  return `${pad(date.getUTCDate())} ${month} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/**
 * A timestamp with its year and milliseconds, in UTC, for detail views and
 * `title` attributes.
 *
 * @param iso - An ISO-8601 instant from a DTO.
 * @returns The formatted instant, or a placeholder when unparseable.
 */
export function formatUtcTimestampLong(iso: string): string {
  const date = toValidDate(iso);
  if (date === null) return EMPTY_VALUE;

  const month = MONTHS[date.getUTCMonth()] ?? "";
  const millis = date.getUTCMilliseconds().toString().padStart(3, "0");
  return `${pad(date.getUTCDate())} ${month} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${millis} UTC`;
}

/**
 * The value for a `datetime-local` input, in UTC.
 *
 * @param date - The bound currently applied, if any.
 * @returns A `YYYY-MM-DDTHH:mm` string, or an empty string when unset.
 */
export function toDateTimeLocalValue(date: Date | undefined): string {
  if (date === undefined || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

/**
 * A count with thousands separators.
 *
 * @param value - The count.
 * @returns The formatted count, e.g. `12,405`.
 */
export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

/**
 * An error rate as a percentage of total events.
 *
 * @param errorCount - Events at `error` or `fatal`.
 * @param eventCount - All events in the same window.
 * @returns The rate to one decimal place, or `0%` when there were no events.
 */
export function formatErrorRate(
  errorCount: number,
  eventCount: number,
): string {
  if (eventCount <= 0) return "0%";
  return `${((errorCount / eventCount) * 100).toFixed(1)}%`;
}

/**
 * A context blob as indented JSON text.
 *
 * The result is a STRING, rendered by the caller inside a `<pre>` so React
 * escapes it. It is never parsed, evaluated or injected as markup.
 *
 * @param value - The `context` field of an event. Entirely untrusted.
 * @returns Pretty-printed JSON, bounded in length.
 */
export function formatContext(value: unknown): string {
  let serialised: string;

  try {
    serialised = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    // A `Json` column cannot hold a cycle or a BigInt, but this function is
    // the last thing between an untrusted blob and the page: a throw here
    // would take out the whole detail view.
    return "Context could not be displayed.";
  }

  return serialised.length > MAX_CONTEXT_CHARS
    ? `${serialised.slice(0, MAX_CONTEXT_CHARS)}${TRUNCATION_NOTICE}`
    : serialised;
}

/**
 * A stack trace, bounded in length.
 *
 * @param stack - The `errorStack` field of an event. Entirely untrusted.
 * @returns The trace as text, truncated when very long.
 */
export function formatStack(stack: string): string {
  return stack.length > MAX_CONTEXT_CHARS
    ? `${stack.slice(0, MAX_CONTEXT_CHARS)}${TRUNCATION_NOTICE}`
    : stack;
}
