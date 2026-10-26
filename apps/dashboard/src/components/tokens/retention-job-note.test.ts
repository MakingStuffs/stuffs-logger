import { describe, expect, it } from "vitest";

import { describeRunInterval } from "./retention-job-note";

describe("describeRunInterval", () => {
  it.each([
    [3_600_000, "once an hour"],
    [6 * 3_600_000, "once every 6 hours"],
    [30 * 60_000, "once every 30 minutes"],
  ])("words %i ms as %s", (intervalMs, expected) => {
    expect(describeRunInterval(intervalMs)).toBe(expected);
  });
});
