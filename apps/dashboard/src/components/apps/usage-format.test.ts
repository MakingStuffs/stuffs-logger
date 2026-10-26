import { describe, expect, it } from "vitest";

import { formatBytes, percentOfCeiling } from "./usage-format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1536, "1.5 KiB"],
    [52_428_800, "50 MiB"],
    [1024 * 1024 * 1024, "1 GiB"],
  ])("formats %d bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("treats a negative count as zero", () => {
    expect(formatBytes(-5)).toBe("0 B");
  });
});

describe("percentOfCeiling", () => {
  it("rounds down, so a bar never claims a ceiling not yet reached", () => {
    expect(percentOfCeiling(999, 1000)).toBe(99);
  });

  it("caps at 100 once the counter passes the ceiling", () => {
    expect(percentOfCeiling(1500, 1000)).toBe(100);
  });

  it("reports nothing used as 0", () => {
    expect(percentOfCeiling(0, 1000)).toBe(0);
  });
});
