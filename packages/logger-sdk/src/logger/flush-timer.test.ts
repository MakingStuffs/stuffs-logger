import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFlushTimer } from "./flush-timer";

describe("createFlushTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the flush once the delay is up", () => {
    const run = vi.fn();
    createFlushTimer(run).arm(5000);

    vi.advanceTimersByTime(5000);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps the earliest pending flush rather than pushing it back", () => {
    const run = vi.fn();
    const timer = createFlushTimer(run);

    timer.arm(1000);
    timer.arm(60_000);
    vi.advanceTimersByTime(1000);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("can be armed again once it has fired", () => {
    const run = vi.fn();
    const timer = createFlushTimer(run);

    timer.arm(1000);
    vi.advanceTimersByTime(1000);
    timer.arm(1000);
    vi.advanceTimersByTime(1000);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("replaces a waiting flush with an immediate one when asked", () => {
    const run = vi.fn();
    const timer = createFlushTimer(run);

    timer.arm(60_000);
    timer.armIdle();
    vi.advanceTimersByTime(0);

    expect(run).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run a cancelled flush", () => {
    const run = vi.fn();
    const timer = createFlushTimer(run);

    timer.arm(1000);
    timer.cancel();
    vi.advanceTimersByTime(60_000);

    expect(run).not.toHaveBeenCalled();
  });
});
