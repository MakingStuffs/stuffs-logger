import { beforeEach, describe, expect, it } from "vitest";

import {
  LAST_USED_THROTTLE_MS,
  resetLastUsedThrottle,
  shouldStampLastUsed,
} from "./last-used";

const NOW = 1_756_728_000_000;

describe("shouldStampLastUsed", () => {
  beforeEach(() => {
    resetLastUsedThrottle();
  });

  it("stamps the first use of a key", () => {
    expect(shouldStampLastUsed("key-1", NOW)).toBe(true);
  });

  it("does not stamp again within the throttle window", () => {
    shouldStampLastUsed("key-1", NOW);

    expect(shouldStampLastUsed("key-1", NOW + 1)).toBe(false);
    expect(shouldStampLastUsed("key-1", NOW + LAST_USED_THROTTLE_MS - 1)).toBe(
      false,
    );
  });

  it("stamps again once the window has passed", () => {
    shouldStampLastUsed("key-1", NOW);

    expect(shouldStampLastUsed("key-1", NOW + LAST_USED_THROTTLE_MS)).toBe(
      true,
    );
  });

  it("throttles each key independently", () => {
    shouldStampLastUsed("key-1", NOW);

    expect(shouldStampLastUsed("key-2", NOW)).toBe(true);
  });

  it("collapses a burst of requests into a single write", () => {
    const writes = Array.from({ length: 500 }, (_, index) =>
      shouldStampLastUsed("key-1", NOW + index),
    ).filter(Boolean);

    expect(writes).toHaveLength(1);
  });
});
