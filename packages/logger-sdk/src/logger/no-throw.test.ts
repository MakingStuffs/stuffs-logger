import { describe, expect, it, vi } from "vitest";

import { createDiagnostics, safely, safelyAsync } from "./no-throw";
import { isSuppressed } from "./suppression";

describe("createDiagnostics", () => {
  it("forwards a failure to the caller's hook", () => {
    const onError = vi.fn();
    const failure = new Error("boom");

    createDiagnostics(onError)(failure, "logger.capture");

    expect(onError).toHaveBeenCalledWith(failure, "logger.capture");
  });

  it("swallows a hook that throws", () => {
    const report = createDiagnostics(() => {
      throw new Error("the hook itself is broken");
    });

    expect(() => {
      report(new Error("original"), "logger.capture");
    }).not.toThrow();
  });

  it("runs the hook with capture suppressed", () => {
    let suppressedInsideHook = false;
    createDiagnostics(() => {
      suppressedInsideHook = isSuppressed();
    })(new Error("boom"), "logger.capture");

    expect(suppressedInsideHook).toBe(true);
  });

  it("is a no-op when no hook was supplied", () => {
    expect(() => {
      createDiagnostics(undefined)(new Error("boom"), "logger.capture");
    }).not.toThrow();
  });
});

describe("safely", () => {
  it("returns the operation's value", () => {
    expect(safely(() => "ok", vi.fn(), "test")).toBe("ok");
  });

  it("reports and swallows a throw", () => {
    const report = vi.fn();

    expect(
      safely(
        () => {
          throw new Error("boom");
        },
        report,
        "test",
      ),
    ).toBeUndefined();
    expect(report).toHaveBeenCalledWith(expect.any(Error), "test");
  });
});

describe("safelyAsync", () => {
  it("reports and swallows a rejection", async () => {
    const report = vi.fn();

    await expect(
      safelyAsync(() => Promise.reject(new Error("boom")), report, "test"),
    ).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(expect.any(Error), "test");
  });

  it("reports and swallows a synchronous throw", async () => {
    const report = vi.fn();

    await expect(
      safelyAsync(
        () => {
          throw new Error("boom");
        },
        report,
        "test",
      ),
    ).resolves.toBeUndefined();
    expect(report).toHaveBeenCalled();
  });
});
