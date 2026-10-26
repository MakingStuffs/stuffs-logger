import { describe, expect, it } from "vitest";

import {
  buildSeedLogEvents,
  SEED_ADMIN,
  SEED_ENVIRONMENTS,
  SEED_EVENT_COUNT,
  SEED_EVENT_INTERVAL_MS,
  SEED_MEMBER,
  SEED_MESSAGE_MARKER,
  seedLevelCounts,
} from "./fixtures";

/** A fixed instant, so nothing here can flake at a date boundary. */
const NOW = new Date("2026-09-02T12:00:00.000Z");

function build() {
  return buildSeedLogEvents({ applicationId: "app-1", now: NOW });
}

describe("seeded users", () => {
  it("gives the two roles different addresses", () => {
    expect(SEED_ADMIN.email).not.toBe(SEED_MEMBER.email);
  });

  it("gives each role its own storage state file", () => {
    expect(SEED_ADMIN.storageStatePath).not.toBe(SEED_MEMBER.storageStatePath);
  });

  it("uses passwords Better Auth will accept", () => {
    // Better Auth's default `minPasswordLength` is 8; a fixture shorter than
    // that would be refused at creation with a message about the password
    // rather than about the seed.
    expect(SEED_ADMIN.password.length).toBeGreaterThanOrEqual(8);
    expect(SEED_MEMBER.password.length).toBeGreaterThanOrEqual(8);
  });
});

describe("buildSeedLogEvents", () => {
  it("builds the whole corpus", () => {
    expect(build()).toHaveLength(SEED_EVENT_COUNT);
  });

  it("orders events newest first, matching the explorer's own ordering", () => {
    const timestamps = build().map((row) => {
      const { timestamp } = row;
      if (!(timestamp instanceof Date)) throw new Error("expected a Date");
      return timestamp.getTime();
    });

    const descending = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(descending);
  });

  it("starts at the supplied instant and steps back by a fixed interval", () => {
    const [first, second] = build();

    expect(first?.timestamp).toEqual(NOW);
    expect(second?.timestamp).toEqual(
      new Date(NOW.getTime() - SEED_EVENT_INTERVAL_MS),
    );
  });

  it("attributes every row to the application it was given", () => {
    expect(build().every((row) => row.applicationId === "app-1")).toBe(true);
  });

  it("is deterministic for the same inputs", () => {
    expect(build()).toEqual(build());
  });

  it("spreads events across every level in the cycle", () => {
    const levels = new Set(build().map((row) => row.level));

    expect([...levels].sort()).toEqual([
      "DEBUG",
      "ERROR",
      "FATAL",
      "INFO",
      "TRACE",
      "WARN",
    ]);
  });

  it("reports level counts that match what it actually built", () => {
    const rows = build();
    const counts = seedLevelCounts();

    for (const [level, expected] of Object.entries(counts)) {
      expect(rows.filter((row) => row.level === level)).toHaveLength(
        expected ?? 0,
      );
    }
  });

  it("spreads events across both sources", () => {
    const rows = build();

    expect(rows.some((row) => row.source === "BROWSER")).toBe(true);
    expect(rows.some((row) => row.source === "NODE")).toBe(true);
  });

  it("spreads events across both environments, unevenly", () => {
    const rows = build();
    const staging = rows.filter((row) => row.environment === "staging");

    expect(SEED_ENVIRONMENTS).toContain("staging");
    expect(staging.length).toBeGreaterThan(0);
    // Filtering to one environment must visibly narrow the view, or a spec
    // asserting that it does would pass for the wrong reason.
    expect(staging.length).toBeLessThan(rows.length);
  });

  it("gives every message the shared marker so one search matches the corpus", () => {
    expect(
      build().every((row) => row.message.includes(SEED_MESSAGE_MARKER)),
    ).toBe(true);
  });

  it("gives every message a distinct value so a row can be addressed", () => {
    const messages = new Set(build().map((row) => row.message));

    expect(messages.size).toBe(SEED_EVENT_COUNT);
  });

  it("attaches error detail to error and fatal rows only", () => {
    for (const row of build()) {
      const isError = row.level === "ERROR" || row.level === "FATAL";
      expect(row.errorName === null).toBe(!isError);
      expect(row.errorStack === null).toBe(!isError);
    }
  });

  it("gives browser rows a device class and node rows none", () => {
    for (const row of build()) {
      expect(row.deviceType === null).toBe(row.source === "NODE");
    }
  });

  it("rotates browser rows through every device class", () => {
    const devices = new Set(
      build()
        .filter((row) => row.source === "BROWSER")
        .map((row) => row.deviceType),
    );

    expect([...devices].sort()).toEqual(["DESKTOP", "MOBILE", "TABLET"]);
  });

  it("holds receivedAt equal to the client clock so retention cannot sweep a fixture", () => {
    for (const row of build()) {
      expect(row.receivedAt).toEqual(row.timestamp);
    }
  });
});
