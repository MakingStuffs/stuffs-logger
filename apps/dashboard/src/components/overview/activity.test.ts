import { describe, expect, it } from "vitest";

import type { ApplicationActivity, ApplicationSummary } from "@/lib/logs/dto";

import { hasElevatedErrorRate, mergeApplicationActivity } from "./activity";

function makeApplication(
  overrides: Partial<ApplicationSummary> = {},
): ApplicationSummary {
  return {
    id: "app-1",
    slug: "checkout",
    name: "Checkout",
    description: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeActivity(
  overrides: Partial<ApplicationActivity> = {},
): ApplicationActivity {
  return {
    applicationId: "app-1",
    applicationSlug: "checkout",
    applicationName: "Checkout",
    eventCount: 100,
    errorCount: 1,
    ...overrides,
  };
}

describe("mergeApplicationActivity", () => {
  it("carries the counts through for an application that logged", () => {
    const merged = mergeApplicationActivity(
      [makeApplication()],
      [makeActivity({ eventCount: 42, errorCount: 3 })],
    );

    expect(merged).toEqual([
      {
        applicationId: "app-1",
        applicationSlug: "checkout",
        applicationName: "Checkout",
        description: null,
        eventCount: 42,
        errorCount: 3,
      },
    ]);
  });

  it("shows a deliberate zero for an application with no events", () => {
    const merged = mergeApplicationActivity([makeApplication()], []);

    expect(merged[0]?.eventCount).toBe(0);
    expect(merged[0]?.errorCount).toBe(0);
  });

  it("orders the busiest application first", () => {
    const merged = mergeApplicationActivity(
      [
        makeApplication({ id: "app-1", name: "Checkout" }),
        makeApplication({ id: "app-2", name: "Search", slug: "search" }),
      ],
      [
        makeActivity({ applicationId: "app-1", eventCount: 10 }),
        makeActivity({ applicationId: "app-2", eventCount: 90 }),
      ],
    );

    expect(merged.map((card) => card.applicationName)).toEqual([
      "Search",
      "Checkout",
    ]);
  });

  it("falls back to alphabetical order when volumes tie", () => {
    const merged = mergeApplicationActivity(
      [
        makeApplication({ id: "app-2", name: "Search", slug: "search" }),
        makeApplication({ id: "app-1", name: "Checkout" }),
      ],
      [],
    );

    expect(merged.map((card) => card.applicationName)).toEqual([
      "Checkout",
      "Search",
    ]);
  });

  it("ignores activity for an application the viewer cannot see", () => {
    const merged = mergeApplicationActivity(
      [makeApplication()],
      [makeActivity({ applicationId: "app-unknown" })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.eventCount).toBe(0);
  });
});

describe("hasElevatedErrorRate", () => {
  it("is false when nothing was logged", () => {
    expect(
      hasElevatedErrorRate({
        applicationId: "app-1",
        applicationSlug: "checkout",
        applicationName: "Checkout",
        description: null,
        eventCount: 0,
        errorCount: 0,
      }),
    ).toBe(false);
  });

  it("is false for an ordinary error rate", () => {
    expect(
      hasElevatedErrorRate({
        applicationId: "app-1",
        applicationSlug: "checkout",
        applicationName: "Checkout",
        description: null,
        eventCount: 100,
        errorCount: 1,
      }),
    ).toBe(false);
  });

  it("is true once errors dominate", () => {
    expect(
      hasElevatedErrorRate({
        applicationId: "app-1",
        applicationSlug: "checkout",
        applicationName: "Checkout",
        description: null,
        eventCount: 100,
        errorCount: 20,
      }),
    ).toBe(true);
  });
});
