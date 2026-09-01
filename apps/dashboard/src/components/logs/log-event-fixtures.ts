import type { LogEventDetail, LogEventListItem } from "@/lib/logs/dto";

/**
 * Log-event factories for component tests.
 *
 * One factory per DTO rather than a literal per test file: the DTOs gain
 * fields as the data layer bounds more of the row, and four hand-maintained
 * literals meant four places to update — with the type error only surfacing in
 * `tsc`, never in a test run. Every test states just the field it is about and
 * inherits a coherent event for the rest.
 */

/** A representative error event, as the stream projects it. */
export function makeLogEventListItem(
  overrides: Partial<LogEventListItem> = {},
): LogEventListItem {
  return {
    id: "event-1",
    applicationId: "app-1",
    applicationSlug: "checkout",
    applicationName: "Checkout",
    timestamp: "2026-01-15T09:31:04.000Z",
    receivedAt: "2026-01-15T09:31:05.000Z",
    level: "error",
    message: "Payment provider timed out",
    logger: "manual",
    environment: "production",
    release: "1.4.2",
    source: "browser",
    sessionId: "session-1",
    url: "https://shop.example.test/checkout",
    deviceType: "mobile",
    os: "iOS 18",
    browser: "Safari",
    errorName: "TimeoutError",
    hasContext: true,
    context: { orderId: "abc-123" },
    contextTruncated: false,
    errorStack: "TimeoutError: Timed out\n    at pay (checkout.js:14:9)",
    errorStackTruncated: false,
    ...overrides,
  };
}

/**
 * The same event as its own page sees it: the extra columns, and both
 * truncation flags false, because a detail row is never bounded.
 */
export function makeLogEventDetail(
  overrides: Partial<LogEventDetail> = {},
): LogEventDetail {
  return {
    ...makeLogEventListItem(),
    userAgent: "Mozilla/5.0",
    errorMessage: "Timed out after 30s",
    ...overrides,
  };
}
