import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isOriginRegisteredCached,
  ORIGIN_CACHE_TTL_MS,
  ORIGIN_LOOKUP_BUDGET,
  ORIGIN_LOOKUP_WINDOW_MS,
  resetOriginRegistryCache,
} from "./origin-registry";

const ORIGIN = "https://app.example.test";
const START = 1_000_000;

beforeEach(() => {
  resetOriginRegistryCache();
});

describe("isOriginRegisteredCached", () => {
  it("asks the registry on a cache miss", async () => {
    const lookup = vi.fn().mockResolvedValue(true);

    await expect(isOriginRegisteredCached(ORIGIN, lookup, START)).resolves.toBe(
      true,
    );
    expect(lookup).toHaveBeenCalledWith(ORIGIN);
  });

  it("answers a repeat preflight from cache, without a query", async () => {
    const lookup = vi.fn().mockResolvedValue(true);

    await isOriginRegisteredCached(ORIGIN, lookup, START);
    await isOriginRegisteredCached(ORIGIN, lookup, START + 1_000);

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("caches a refusal too, so unknown origins are not a query amplifier", async () => {
    const lookup = vi.fn().mockResolvedValue(false);

    await isOriginRegisteredCached(ORIGIN, lookup, START);
    const second = await isOriginRegisteredCached(ORIGIN, lookup, START + 500);

    expect(second).toBe(false);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("re-asks once the entry has expired", async () => {
    const lookup = vi.fn().mockResolvedValue(true);

    await isOriginRegisteredCached(ORIGIN, lookup, START);
    await isOriginRegisteredCached(
      ORIGIN,
      lookup,
      START + ORIGIN_CACHE_TTL_MS + 1,
    );

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("stops querying once the lookup budget is spent", async () => {
    const lookup = vi.fn().mockResolvedValue(true);

    for (let index = 0; index < ORIGIN_LOOKUP_BUDGET + 10; index += 1) {
      await isOriginRegisteredCached(
        `https://o${index}.example.test`,
        lookup,
        START,
      );
    }

    expect(lookup).toHaveBeenCalledTimes(ORIGIN_LOOKUP_BUDGET);
  });

  it("fails closed when the budget is spent", async () => {
    const lookup = vi.fn().mockResolvedValue(true);

    for (let index = 0; index < ORIGIN_LOOKUP_BUDGET; index += 1) {
      await isOriginRegisteredCached(
        `https://o${index}.example.test`,
        lookup,
        START,
      );
    }

    await expect(
      isOriginRegisteredCached("https://new.example.test", lookup, START),
    ).resolves.toBe(false);
  });

  it("still serves cached answers while the budget is spent", async () => {
    const lookup = vi.fn().mockResolvedValue(true);

    await isOriginRegisteredCached(ORIGIN, lookup, START);
    for (let index = 0; index < ORIGIN_LOOKUP_BUDGET; index += 1) {
      await isOriginRegisteredCached(
        `https://o${index}.example.test`,
        lookup,
        START,
      );
    }

    await expect(isOriginRegisteredCached(ORIGIN, lookup, START)).resolves.toBe(
      true,
    );
  });

  it("restores the budget in the next window", async () => {
    const lookup = vi.fn().mockResolvedValue(true);

    for (let index = 0; index < ORIGIN_LOOKUP_BUDGET; index += 1) {
      await isOriginRegisteredCached(
        `https://o${index}.example.test`,
        lookup,
        START,
      );
    }
    lookup.mockClear();

    await isOriginRegisteredCached(
      "https://new.example.test",
      lookup,
      START + ORIGIN_LOOKUP_WINDOW_MS + 1,
    );

    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
