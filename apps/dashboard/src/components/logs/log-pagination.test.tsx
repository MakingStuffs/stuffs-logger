import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LogEventListItem, LogEventPage } from "@/lib/logs/dto";
import { DEFAULT_PAGE_SIZE } from "@/lib/logs/filters";
import type { LogFilters } from "@/lib/logs/filters";

import { LogPagination } from "./log-pagination";

function makeItems(count: number): LogEventListItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${index}`,
    applicationId: "app-1",
    applicationSlug: "checkout",
    applicationName: "Checkout",
    timestamp: "2026-01-15T09:31:04.000Z",
    receivedAt: "2026-01-15T09:31:05.000Z",
    level: "info" as const,
    message: "Hello",
    logger: "manual" as const,
    environment: "production",
    release: null,
    source: "browser" as const,
    sessionId: null,
    url: null,
    deviceType: null,
    os: null,
    browser: null,
    errorName: null,
    hasContext: false,
  }));
}

function makePage(overrides: Partial<LogEventPage> = {}): LogEventPage {
  return {
    items: makeItems(2),
    nextCursor: null,
    hasMore: false,
    ...overrides,
  };
}

function makeFilters(overrides: Partial<LogFilters> = {}): LogFilters {
  return { limit: DEFAULT_PAGE_SIZE, ...overrides };
}

describe("LogPagination", () => {
  it("says the whole result set is on screen when it is", () => {
    render(<LogPagination filters={makeFilters()} page={makePage()} />);

    expect(screen.getByText(/showing all 2 events/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("offers the next page, carrying the filters and the cursor", () => {
    render(
      <LogPagination
        filters={makeFilters({ search: "timeout" })}
        page={makePage({ hasMore: true, nextCursor: "event-9" })}
      />,
    );

    expect(
      screen.getByRole("link", { name: /go to next page/i }),
    ).toHaveAttribute("href", "/logs?search=timeout&cursor=event-9");
  });

  it("offers a way back to the newest page once paging has started", () => {
    render(
      <LogPagination
        filters={makeFilters({ search: "timeout", cursor: "event-9" })}
        page={makePage()}
      />,
    );

    expect(screen.getByRole("link", { name: "Newest" })).toHaveAttribute(
      "href",
      "/logs?search=timeout",
    );
  });

  it("offers no next page at the end of the stream", () => {
    render(
      <LogPagination
        filters={makeFilters({ cursor: "event-9" })}
        page={makePage()}
      />,
    );

    expect(
      screen.queryByRole("link", { name: /go to next page/i }),
    ).not.toBeInTheDocument();
  });
});
