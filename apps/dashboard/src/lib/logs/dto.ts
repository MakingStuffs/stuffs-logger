import type {
  DeviceType,
  LogLevel,
  LoggerKind,
  LogSource,
} from "@jf-logger/core";

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
  /**
   * Whether the row has a `context` blob, so the list can show an indicator
   * without shipping every blob in the payload.
   */
  hasContext: boolean;
}

/**
 * A single log line in full.
 *
 * Separate from the list item because `context`, `userAgent` and the stack
 * trace are large and are only ever wanted one row at a time. Two audiences,
 * two projections.
 */
export interface LogEventDetail extends LogEventListItem {
  userAgent: string | null;
  /** The caller-supplied context blob. Untrusted data — render it as text. */
  context: unknown;
  errorMessage: string | null;
  errorStack: string | null;
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
