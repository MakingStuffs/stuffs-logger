import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeSignInAttempt,
  resetSignInThrottle,
  SIGN_IN_MAX_ATTEMPTS,
  SIGN_IN_WINDOW_MS,
} from "./sign-in-throttle";

const START = 1_700_000_000_000;

beforeEach(() => {
  resetSignInThrottle();
});

describe("consumeSignInAttempt", () => {
  it("allows attempts up to the ceiling", () => {
    for (let attempt = 1; attempt <= SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
      expect(consumeSignInAttempt("someone@example.test", START).allowed).toBe(
        true,
      );
    }
  });

  it("refuses the attempt after the ceiling", () => {
    for (let attempt = 1; attempt <= SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
      consumeSignInAttempt("someone@example.test", START);
    }

    expect(consumeSignInAttempt("someone@example.test", START).allowed).toBe(
      false,
    );
  });

  it("throttles one identity without throttling another", () => {
    for (let attempt = 0; attempt <= SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
      consumeSignInAttempt("victim@example.test", START);
    }

    expect(consumeSignInAttempt("victim@example.test", START).allowed).toBe(
      false,
    );
    expect(consumeSignInAttempt("someone@example.test", START).allowed).toBe(
      true,
    );
  });

  it("treats an address as the same identity regardless of case or padding", () => {
    for (let attempt = 1; attempt <= SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
      consumeSignInAttempt("Victim@Example.test", START);
    }

    expect(consumeSignInAttempt("  victim@example.test  ", START).allowed).toBe(
      false,
    );
  });

  it("opens the window again once it has elapsed", () => {
    for (let attempt = 0; attempt <= SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
      consumeSignInAttempt("someone@example.test", START);
    }

    expect(
      consumeSignInAttempt("someone@example.test", START + SIGN_IN_WINDOW_MS)
        .allowed,
    ).toBe(true);
  });

  it("reports how long is left, for the message shown to the user", () => {
    for (let attempt = 0; attempt <= SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
      consumeSignInAttempt("someone@example.test", START);
    }

    const refused = consumeSignInAttempt("someone@example.test", START + 1_000);

    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe((SIGN_IN_WINDOW_MS - 1_000) / 1_000);
  });

  it("refuses an empty identity rather than pooling every blank attempt", () => {
    expect(consumeSignInAttempt("", START).allowed).toBe(false);
  });

  it("does not grow without bound as identities churn", () => {
    for (let index = 0; index < 20_000; index += 1) {
      consumeSignInAttempt(`user-${index}@example.test`, START + index);
    }

    // Still counting: eviction must never hand out an unlimited allowance.
    for (let attempt = 0; attempt <= SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
      consumeSignInAttempt("steady@example.test", START + 20_000);
    }

    expect(
      consumeSignInAttempt("steady@example.test", START + 20_000).allowed,
    ).toBe(false);
  });
});
