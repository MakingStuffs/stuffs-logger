import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isOriginRegisteredCached,
  ORIGIN_SNAPSHOT_RETRY_MS,
  ORIGIN_SNAPSHOT_TTL_MS,
  resetOriginRegistrySnapshot,
} from "./origin-registry";

const ORIGIN = "https://app.example.test";
const OTHER_ORIGIN = "https://other.example.test";
const START = 1_000_000;

beforeEach(() => {
  resetOriginRegistrySnapshot();
});

describe("isOriginRegisteredCached", () => {
  it("loads the registry once and answers from it", async () => {
    const load = vi.fn().mockResolvedValue([ORIGIN]);

    await expect(isOriginRegisteredCached(ORIGIN, load, START)).resolves.toBe(
      true,
    );
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refuses an origin the registry does not carry", async () => {
    const load = vi.fn().mockResolvedValue([ORIGIN]);

    await expect(
      isOriginRegisteredCached(OTHER_ORIGIN, load, START),
    ).resolves.toBe(false);
  });

  it("answers a repeat preflight without a query", async () => {
    const load = vi.fn().mockResolvedValue([ORIGIN]);

    await isOriginRegisteredCached(ORIGIN, load, START);
    await isOriginRegisteredCached(ORIGIN, load, START + 1_000);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("costs nothing extra for an origin never seen before", async () => {
    // The point of the snapshot: a flood of DISTINCT origins is answered from
    // the same load, so it cannot exhaust anything on anyone else's behalf.
    const load = vi.fn().mockResolvedValue([ORIGIN]);

    for (let index = 0; index < 500; index += 1) {
      await isOriginRegisteredCached(
        `https://o${index}.example.test`,
        load,
        START,
      );
    }

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("still grants a registered origin during such a flood", async () => {
    const load = vi.fn().mockResolvedValue([ORIGIN]);

    for (let index = 0; index < 500; index += 1) {
      await isOriginRegisteredCached(
        `https://o${index}.example.test`,
        load,
        START,
      );
    }

    await expect(isOriginRegisteredCached(ORIGIN, load, START)).resolves.toBe(
      true,
    );
  });

  it("reloads once the snapshot has expired", async () => {
    const load = vi.fn().mockResolvedValue([ORIGIN]);

    await isOriginRegisteredCached(ORIGIN, load, START);
    await isOriginRegisteredCached(
      ORIGIN,
      load,
      START + ORIGIN_SNAPSHOT_TTL_MS + 1,
    );

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("picks up an origin added since the last snapshot", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([ORIGIN]);

    await expect(isOriginRegisteredCached(ORIGIN, load, START)).resolves.toBe(
      false,
    );
    await expect(
      isOriginRegisteredCached(
        ORIGIN,
        load,
        START + ORIGIN_SNAPSHOT_TTL_MS + 1,
      ),
    ).resolves.toBe(true);
  });

  it("shares one load between concurrent preflights", async () => {
    const load = vi.fn().mockResolvedValue([ORIGIN]);

    const answers = await Promise.all([
      isOriginRegisteredCached(ORIGIN, load, START),
      isOriginRegisteredCached(OTHER_ORIGIN, load, START),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(answers).toEqual([true, false]);
  });

  it("fails closed when the registry cannot be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const load = vi.fn().mockRejectedValue(new Error("database is down"));

    await expect(isOriginRegisteredCached(ORIGIN, load, START)).resolves.toBe(
      false,
    );
  });

  it("keeps answering from the last good snapshot when a reload fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const load = vi
      .fn()
      .mockResolvedValueOnce([ORIGIN])
      .mockRejectedValue(new Error("database is down"));

    await isOriginRegisteredCached(ORIGIN, load, START);

    await expect(
      isOriginRegisteredCached(
        ORIGIN,
        load,
        START + ORIGIN_SNAPSHOT_TTL_MS + 1,
      ),
    ).resolves.toBe(true);
    await expect(
      isOriginRegisteredCached(
        OTHER_ORIGIN,
        load,
        START + ORIGIN_SNAPSHOT_TTL_MS + 1,
      ),
    ).resolves.toBe(false);
  });

  it("backs off after a failed load rather than retrying per preflight", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const load = vi.fn().mockRejectedValue(new Error("database is down"));

    await isOriginRegisteredCached(ORIGIN, load, START);
    await isOriginRegisteredCached(ORIGIN, load, START + 1);
    await isOriginRegisteredCached(
      ORIGIN,
      load,
      START + ORIGIN_SNAPSHOT_RETRY_MS - 1,
    );

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries once the backoff has elapsed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("database is down"))
      .mockResolvedValue([ORIGIN]);

    await isOriginRegisteredCached(ORIGIN, load, START);

    await expect(
      isOriginRegisteredCached(
        ORIGIN,
        load,
        START + ORIGIN_SNAPSHOT_RETRY_MS + 1,
      ),
    ).resolves.toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
