import { describe, expect, it } from "vitest";

import {
  consumeDailyQuota,
  DAILY_BYTE_QUOTA,
  DAILY_EVENT_QUOTA,
  utcDayStart,
  type ApplicationUsageStore,
} from "./quota";

const APPLICATION = "app-1";

/**
 * An in-memory stand-in for the Postgres counters, keyed the same way the real
 * row is: application plus UTC day. Seeded totals stand in for volume already
 * sent today.
 */
function makeStore(
  seed: Record<string, { eventCount: number; byteCount: number }> = {},
): ApplicationUsageStore & {
  rows: Map<string, { eventCount: number; byteCount: number }>;
  writes: number;
} {
  const rows = new Map(Object.entries(seed));

  return {
    rows,
    writes: 0,
    async increment({ applicationId, day, delta }) {
      this.writes += 1;

      const key = `${applicationId}:${day.toISOString()}`;
      const current = rows.get(key) ?? { eventCount: 0, byteCount: 0 };
      const next = {
        eventCount: current.eventCount + delta.events,
        byteCount: current.byteCount + delta.bytes,
      };

      rows.set(key, next);
      return next;
    },
  };
}

function keyFor(now: Date): string {
  return `${APPLICATION}:${utcDayStart(now).toISOString()}`;
}

const NOON = new Date("2026-09-01T12:00:00.000Z");
const NEXT_DAY = new Date("2026-09-02T00:30:00.000Z");

describe("utcDayStart", () => {
  it("buckets a moment onto midnight UTC of its own day", () => {
    expect(
      utcDayStart(new Date("2026-09-01T23:30:00.000Z")).toISOString(),
    ).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rolls over at UTC midnight, not local midnight", () => {
    expect(
      utcDayStart(new Date("2026-09-02T00:00:01.000Z")).toISOString(),
    ).toBe("2026-09-02T00:00:00.000Z");
  });
});

describe("consumeDailyQuota", () => {
  it("allows a batch when the day is well under quota", async () => {
    const store = makeStore();

    const result = await consumeDailyQuota(
      APPLICATION,
      { events: 10, bytes: 1000 },
      { store, now: NOON },
    );

    expect(result.allowed).toBe(true);
    expect(result.totals).toEqual({ eventCount: 10, byteCount: 1000 });
  });

  it("costs exactly one write per batch, whatever its size", async () => {
    const store = makeStore();

    await consumeDailyQuota(
      APPLICATION,
      { events: 100, bytes: 50_000 },
      { store, now: NOON },
    );

    expect(store.writes).toBe(1);
  });

  it("allows the batch that lands exactly on the ceiling", async () => {
    const store = makeStore({
      [keyFor(NOON)]: { eventCount: DAILY_EVENT_QUOTA - 10, byteCount: 0 },
    });

    const result = await consumeDailyQuota(
      APPLICATION,
      { events: 10, bytes: 100 },
      { store, now: NOON },
    );

    expect(result.allowed).toBe(true);
    expect(result.totals.eventCount).toBe(DAILY_EVENT_QUOTA);
  });

  it("refuses the next batch once the event ceiling is reached", async () => {
    const store = makeStore({
      [keyFor(NOON)]: { eventCount: DAILY_EVENT_QUOTA, byteCount: 0 },
    });

    const result = await consumeDailyQuota(
      APPLICATION,
      { events: 1, bytes: 100 },
      { store, now: NOON },
    );

    expect(result).toMatchObject({
      allowed: false,
      reason: "daily_event_quota",
    });
  });

  it("refuses once the byte ceiling is crossed, even on few events", async () => {
    const store = makeStore({
      [keyFor(NOON)]: { eventCount: 1, byteCount: DAILY_BYTE_QUOTA },
    });

    const result = await consumeDailyQuota(
      APPLICATION,
      { events: 1, bytes: 100 },
      { store, now: NOON },
    );

    expect(result).toMatchObject({
      allowed: false,
      reason: "daily_byte_quota",
    });
  });

  it("reports how long until the quota resets", async () => {
    const store = makeStore({
      [keyFor(NOON)]: { eventCount: DAILY_EVENT_QUOTA, byteCount: 0 },
    });

    const result = await consumeDailyQuota(
      APPLICATION,
      { events: 1, bytes: 1 },
      { store, now: NOON },
    );

    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.retryAfterSeconds).toBe(12 * 60 * 60);
  });

  it("keeps counting a refused caller's volume", async () => {
    const store = makeStore({
      [keyFor(NOON)]: { eventCount: DAILY_EVENT_QUOTA, byteCount: 0 },
    });

    await consumeDailyQuota(
      APPLICATION,
      { events: 5, bytes: 100 },
      { store, now: NOON },
    );

    expect(store.rows.get(keyFor(NOON))?.eventCount).toBe(
      DAILY_EVENT_QUOTA + 5,
    );
  });

  it("starts a fresh allowance on the next UTC day", async () => {
    const store = makeStore({
      [keyFor(NOON)]: { eventCount: DAILY_EVENT_QUOTA, byteCount: 0 },
    });

    const refused = await consumeDailyQuota(
      APPLICATION,
      { events: 1, bytes: 1 },
      { store, now: NOON },
    );
    const allowed = await consumeDailyQuota(
      APPLICATION,
      { events: 1, bytes: 1 },
      { store, now: NEXT_DAY },
    );

    expect(refused.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
    expect(allowed.totals.eventCount).toBe(1);
  });

  it("counts each application separately", async () => {
    const store = makeStore({
      [keyFor(NOON)]: { eventCount: DAILY_EVENT_QUOTA, byteCount: 0 },
    });

    const other = await consumeDailyQuota(
      "app-2",
      { events: 1, bytes: 1 },
      { store, now: NOON },
    );

    expect(other.allowed).toBe(true);
  });
});
