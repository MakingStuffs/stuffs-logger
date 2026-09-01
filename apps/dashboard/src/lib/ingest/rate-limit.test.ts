import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeRateLimit,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  resetRateLimits,
} from "./rate-limit";

const NOW = 1_756_728_000_000;

describe("consumeRateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("allows the first request", () => {
    expect(consumeRateLimit("key-1", NOW).allowed).toBe(true);
  });

  it("allows requests up to the limit", () => {
    for (let request = 0; request < RATE_LIMIT_MAX_REQUESTS; request += 1) {
      expect(consumeRateLimit("key-1", NOW).allowed).toBe(true);
    }
  });

  it("refuses the request after the limit", () => {
    for (let request = 0; request < RATE_LIMIT_MAX_REQUESTS; request += 1) {
      consumeRateLimit("key-1", NOW);
    }

    expect(consumeRateLimit("key-1", NOW).allowed).toBe(false);
  });

  it("reports how long until the window resets", () => {
    for (let request = 0; request <= RATE_LIMIT_MAX_REQUESTS; request += 1) {
      consumeRateLimit("key-1", NOW);
    }

    const result = consumeRateLimit("key-1", NOW + 15_000);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(45);
  });

  it("counts each key separately", () => {
    for (let request = 0; request <= RATE_LIMIT_MAX_REQUESTS; request += 1) {
      consumeRateLimit("key-1", NOW);
    }

    expect(consumeRateLimit("key-2", NOW).allowed).toBe(true);
  });

  it("starts a fresh window once the old one expires", () => {
    for (let request = 0; request <= RATE_LIMIT_MAX_REQUESTS; request += 1) {
      consumeRateLimit("key-1", NOW);
    }
    expect(consumeRateLimit("key-1", NOW).allowed).toBe(false);

    expect(consumeRateLimit("key-1", NOW + RATE_LIMIT_WINDOW_MS).allowed).toBe(
      true,
    );
  });
});
