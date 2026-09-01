import type {
  DeviceType,
  LogLevel,
  LoggerKind,
  LogSource,
} from "@stuffs-logger/core";

/**
 * The shapes the dashboard is allowed to see.
 *
 * Every query projects into one of these. The frontend never receives a Prisma
 * row, so it cannot render — or accidentally serialise into a client component
 * — a column that was not deliberately exposed. Dates cross as ISO strings so
 * a server component can pass them to a client component without a
 * serialisation boundary error.
 */

/** A log line as it appears in the stream. */
export interface LogEventListItem {
  id: string;
  applicationId: string;
  applicationSlug: string;
  applicationName: string;
  /** The client's clock, clamped. ISO-8601. */
  timestamp: string;
  /** The server's clock. ISO-8601. */
  receivedAt: string;
  level: LogLevel;
  message: string;
  logger: LoggerKind;
  environment: string;
  release: string | null;
  source: LogSource;
  sessionId: string | null;
  url: string | null;
  deviceType: DeviceType | null;
  os: string | null;
  browser: string | null;
  errorName: string | null;
  /** Whether the row has a `context` blob at all, truncated or not. */
  hasContext: boolean;
  /**
   * The caller-supplied context blob, bounded for the list payload.
   *
   * The stream query reads this column regardless — it is on a row it is
   * already fetching — so it is exposed rather than discarded, and the
   * expanded row renders it without a second query. Redacted and sanitised at
   * ingest, but still untrusted data: render it as TEXT, never as markup.
   *
   * `null` when the row has no context, and also when the whole value was too
   * large to carry (`contextTruncated` tells the two apart).
   */
  context: unknown;
  /**
   * Whether `context` is a reduced version of what is stored. When true, the
   * event's own page has the complete blob.
   */
  contextTruncated: boolean;
  /** The stack trace, cut to the list budget. `null` when there is none. */
  errorStack: string | null;
  /** Whether `errorStack` was cut short. */
  errorStackTruncated: boolean;
}

/**
 * A single log line in full.
 *
 * Separate from the list item because `userAgent`, `errorMessage` and the
 * UNTRUNCATED context and stack are only ever wanted one row at a time. Two
 * audiences, two projections — on a detail row both truncation flags are
 * always `false`.
 */
export interface LogEventDetail extends LogEventListItem {
  userAgent: string | null;
  errorMessage: string | null;
}

/** One page of the log stream. */
export interface LogEventPage {
  items: LogEventListItem[];
  /** Pass back as `cursor` to fetch the next page; `null` at the end. */
  nextCursor: string | null;
  /** Whether another page exists. */
  hasMore: boolean;
}

/** An application, as the dashboard lists it. */
export interface ApplicationSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: string;
}

/** Per-application counts over a time window, for the overview. */
export interface ApplicationActivity {
  applicationId: string;
  applicationSlug: string;
  applicationName: string;
  /** Events received in the window. */
  eventCount: number;
  /** Of those, events at `error` or `fatal`. */
  errorCount: number;
}

/**
 * An ingest key as shown to an internal user.
 *
 * NOTE what is absent: `secretHash` is never projected, and the plaintext of a
 * secret key exists only in the response that created it. There is no shape in
 * this file that can carry either.
 */
export interface IngestKeySummary {
  id: string;
  applicationId: string;
  name: string;
  type: "PUBLIC" | "SECRET";
  /**
   * PUBLIC keys only: the literal key, which is safe to display — it is
   * designed to be shipped in browser JS. `null` for secret keys.
   */
  publicKey: string | null;
  allowedOrigins: string[];
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}
