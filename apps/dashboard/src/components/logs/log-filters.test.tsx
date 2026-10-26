import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ApplicationSummary } from "@/lib/logs/dto";
import { DEFAULT_PAGE_SIZE } from "@/lib/logs/constants";
import { parseLogFilters } from "@/lib/logs/filters";
import type { LogFilters } from "@/lib/logs/filters";

import { LOG_FILTER_PARAMS } from "./filter-vocabulary";
import { LogFiltersPanel } from "./log-filters";

const NOW = new Date("2026-01-15T12:00:00.000Z");

const APPLICATIONS: ApplicationSummary[] = [
  {
    id: "app-1",
    slug: "checkout",
    name: "Checkout",
    description: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

function renderPanel(overrides: Partial<LogFilters> = {}) {
  return render(
    <LogFiltersPanel
      filters={{ limit: DEFAULT_PAGE_SIZE, ...overrides }}
      applications={APPLICATIONS}
      environments={["production", "staging"]}
      now={NOW}
    />,
  );
}

describe("LogFiltersPanel", () => {
  it("submits to the explorer as a plain GET, so filters land in the URL", () => {
    renderPanel();

    const form = screen.getByRole("form", { name: "Log filters" });
    expect(form).toHaveAttribute("action", "/logs");
    expect(form).toHaveAttribute("method", "get");
  });

  it("labels every control", () => {
    renderPanel();

    expect(screen.getByLabelText("Application")).toBeInTheDocument();
    expect(screen.getByLabelText("Message contains")).toBeInTheDocument();
    expect(screen.getByLabelText("Results per page")).toBeInTheDocument();
    expect(screen.getByLabelText("From (UTC)")).toBeInTheDocument();
    expect(screen.getByLabelText("To (UTC)")).toBeInTheDocument();
  });

  it("offers each severity as a checkbox named in words", () => {
    renderPanel();

    expect(screen.getByRole("checkbox", { name: "Error" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Trace" })).toBeInTheDocument();
  });

  it("ticks the severities that are currently applied", () => {
    renderPanel({ level: ["error", "fatal"] });

    expect(screen.getByRole("checkbox", { name: "Error" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Fatal" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Info" })).not.toBeChecked();
  });

  it("echoes the current search term back into the field", () => {
    renderPanel({ search: "timeout" });

    expect(screen.getByLabelText("Message contains")).toHaveValue("timeout");
  });

  it("echoes the current application back into the select", () => {
    renderPanel({ applicationSlug: "checkout" });

    expect(screen.getByLabelText("Application")).toHaveValue("checkout");
  });

  it("echoes a lower bound the user chose back into the From field", () => {
    renderPanel({ from: NOW });

    expect(screen.getByLabelText("From (UTC)")).toHaveValue("2026-01-15T12:00");
  });

  it("leaves the From field empty when the lower bound was defaulted, so submitting does not pin it", () => {
    renderPanel({ search: "timeout", from: NOW, fromDefaulted: true });

    expect(screen.getByLabelText("From (UTC)")).toHaveValue("");
  });

  it("carries an id-scoped filter through as a hidden field", () => {
    const { container } = renderPanel({ applicationId: "app-1" });

    expect(
      container.querySelector('input[type="hidden"][name="applicationId"]'),
    ).toHaveValue("app-1");
  });

  it("offers one environment checkbox per environment seen in the data", () => {
    renderPanel();

    expect(
      screen.getByRole("checkbox", { name: "production" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "staging" }),
    ).toBeInTheDocument();
  });

  it("offers quick ranges as absolute-instant links", () => {
    renderPanel();

    expect(screen.getByRole("link", { name: "Last hour" })).toHaveAttribute(
      "href",
      "/logs?from=2026-01-15T11%3A00%3A00.000Z",
    );
  });

  it("clears the range with the all-time link", () => {
    renderPanel({ from: NOW });

    expect(screen.getByRole("link", { name: "All time" })).toHaveAttribute(
      "href",
      "/logs",
    );
  });

  it("makes the all-time link explicit while searching, so the default window cannot override it", () => {
    renderPanel({ search: "timeout", from: NOW, fromDefaulted: true });

    expect(screen.getByRole("link", { name: "All time" })).toHaveAttribute(
      "href",
      "/logs?search=timeout&window=all",
    );
  });

  it("carries an explicit all-time window through as a hidden field", () => {
    const { container } = renderPanel({ search: "timeout", window: "all" });

    expect(
      container.querySelector('input[type="hidden"][name="window"]'),
    ).toHaveValue("all");
  });

  it("keeps other filters when a quick range is chosen", () => {
    renderPanel({ applicationSlug: "checkout" });

    expect(screen.getByRole("link", { name: "Last hour" })).toHaveAttribute(
      "href",
      "/logs?applicationSlug=checkout&from=2026-01-15T11%3A00%3A00.000Z",
    );
  });

  it("offers a way back to an unfiltered view", () => {
    renderPanel({ search: "timeout" });

    expect(
      screen.getByRole("link", { name: /clear filters/i }),
    ).toHaveAttribute("href", "/logs");
  });

  it("does not submit a cursor, so changing a filter starts from the newest page", () => {
    const { container } = renderPanel({ cursor: "event-9" });

    expect(container.querySelector('[name="cursor"]')).toBeNull();
  });

  it("names every control after a param the closed filter schema accepts", () => {
    renderPanel({ applicationId: "app-1", search: "timeout" });

    const form = screen.getByRole("form", { name: "Log filters" });
    const names = Array.from(form.querySelectorAll<HTMLElement>("[name]")).map(
      (control) => control.getAttribute("name"),
    );

    expect(names.length).toBeGreaterThan(0);
    for (const name of new Set(names)) {
      expect(LOG_FILTER_PARAMS).toContain(name);
    }
  });

  it("emits only links the closed filter schema accepts", () => {
    renderPanel({ applicationSlug: "checkout", level: ["error"] });

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "");

    for (const href of hrefs) {
      const url = new URL(href, "https://logs.test");
      const raw: Record<string, string | string[]> = {};
      for (const key of new Set(url.searchParams.keys())) {
        const values = url.searchParams.getAll(key);
        raw[key] = values.length > 1 ? values : (values[0] ?? "");
      }
      expect(parseLogFilters(raw)).toMatchObject({ ok: true });
    }
  });

  it("opens the secondary filters when one of them is applied", () => {
    const { container } = renderPanel({ source: ["browser"] });

    expect(container.querySelector("details")).toHaveAttribute("open");
  });
});
