import { describe, expect, it } from "vitest";

import { emptyContextCollector } from "../context/collector";
import type { ContextCollector } from "../context/collector";
import { createEventFactory } from "./event-factory";
import { createRedactor } from "./redact";

const redactor = createRedactor(undefined);

function factory(collector: ContextCollector = emptyContextCollector) {
  return createEventFactory({ collector, redactor, context: undefined });
}

describe("createEventFactory", () => {
  it("redacts an object passed as the message before it is stringified", () => {
    const event = factory().build(
      { level: "error", message: { user: "ada", password: "hunter2" } },
      "error",
    );

    expect(event.message).toContain("[redacted]");
    expect(event.message).not.toContain("hunter2");
  });

  it("redacts a thrown plain object before it becomes the error message", () => {
    const event = factory().build(
      { level: "error", message: "failed", error: { token: "abc123" } },
      "error",
    );

    expect(event.error?.message).toContain("[redacted]");
    expect(event.error?.message).not.toContain("abc123");
  });

  it("falls back to manual for a logger kind the contract does not know", () => {
    const event = factory().build(
      { level: "info", message: "x", logger: "bogus" as never },
      "info",
    );

    expect(event.logger).toBe("manual");
  });

  it("keeps a logger kind the contract knows", () => {
    const event = factory().build(
      { level: "info", message: "x", logger: "console" },
      "info",
    );

    expect(event.logger).toBe("console");
  });

  it("redacts the collected url", () => {
    const collector: ContextCollector = {
      sessionId: () => undefined,
      collect: () => ({ url: "https://app.example.com/cb?code=AUTHCODE" }),
    };

    const event = factory(collector).build(
      { level: "info", message: "x" },
      "info",
    );

    expect(event.url).toBe("https://app.example.com/cb?code=[redacted]");
  });
});
