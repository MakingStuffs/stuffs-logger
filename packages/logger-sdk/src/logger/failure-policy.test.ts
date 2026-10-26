import { describe, expect, it } from "vitest";

import { MAX_EVENTS_PER_BATCH } from "../contract";
import {
  MAX_RETRY_DELAY_MS,
  MAX_SEND_ATTEMPTS,
  MIN_RETRY_DELAY_MS,
} from "../defaults";
import { createFailurePolicy } from "./failure-policy";

const NOW = 1_767_000_000_000;

describe("createFailurePolicy", () => {
  it("lets a send go out when nothing has failed", () => {
    expect(createFailurePolicy().waitMs(NOW)).toBe(0);
  });

  it("carries a full batch until the endpoint starts failing", () => {
    expect(createFailurePolicy().eventsPerAttempt).toBe(MAX_EVENTS_PER_BATCH);
  });

  it("keeps the batch for another attempt while attempts remain", () => {
    const policy = createFailurePolicy();

    expect(policy.recordFailure(undefined, NOW).requeue).toBe(true);
  });

  it("backs off further with each consecutive failure", () => {
    const policy = createFailurePolicy();

    const first = policy.recordFailure(undefined, NOW).retryInMs;
    const second = policy.recordFailure(undefined, NOW).retryInMs;

    expect(second).toBeGreaterThan(first);
  });

  it("caps the backoff so a long outage never becomes a spin", () => {
    const policy = createFailurePolicy();

    let retryInMs = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      retryInMs = policy.recordFailure(undefined, NOW).retryInMs;
    }

    expect(retryInMs).toBe(MAX_RETRY_DELAY_MS);
  });

  it("honours a server-supplied delay over its own backoff", () => {
    const policy = createFailurePolicy();

    expect(policy.recordFailure(30_000, NOW).retryInMs).toBe(30_000);
    expect(policy.waitMs(NOW)).toBe(30_000);
    expect(policy.waitMs(NOW + 30_000)).toBe(0);
  });

  it("never lets a Retry-After shorten its own backoff", () => {
    const policy = createFailurePolicy();

    expect(policy.recordFailure(0, NOW).retryInMs).toBe(MIN_RETRY_DELAY_MS);
    expect(policy.waitMs(NOW)).toBe(MIN_RETRY_DELAY_MS);
    expect(policy.recordFailure(0, NOW).retryInMs).toBe(MIN_RETRY_DELAY_MS * 2);
  });

  it("gives up on a batch once the attempts are exhausted", () => {
    const policy = createFailurePolicy();

    for (let attempt = 1; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
      expect(policy.recordFailure(undefined, NOW).requeue).toBe(true);
    }

    expect(policy.recordFailure(undefined, NOW).requeue).toBe(false);
  });

  it("probes with a single event while the endpoint stays down", () => {
    const policy = createFailurePolicy();

    for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
      policy.recordFailure(undefined, NOW);
    }

    expect(policy.eventsPerAttempt).toBe(1);
  });

  it("forgets the backoff as soon as a batch lands", () => {
    const policy = createFailurePolicy();
    for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
      policy.recordFailure(undefined, NOW);
    }

    policy.recordSuccess();

    expect(policy.waitMs(NOW)).toBe(0);
    expect(policy.eventsPerAttempt).toBe(MAX_EVENTS_PER_BATCH);
  });
});
