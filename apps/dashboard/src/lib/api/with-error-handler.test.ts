import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "./errors";
import { apiSuccess } from "./responses";
import { withErrorHandler } from "./with-error-handler";

function makeRequest(): Request {
  return new Request("https://logger.test/api/v1/ingest", { method: "POST" });
}

describe("withErrorHandler", () => {
  it("returns the handler's response untouched when nothing throws", async () => {
    const handler = withErrorHandler({ context: "test" }, async () =>
      apiSuccess({ accepted: 1 }, { status: 202 }),
    );

    const response = await handler(makeRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { accepted: 1 },
    });
  });

  it("serialises a typed error into the envelope with its status", async () => {
    const handler = withErrorHandler({ context: "test" }, async () => {
      throw new ApiError(
        "RATE_LIMITED",
        "Too many requests for this ingest key.",
      );
    });

    const response = await handler(makeRequest());

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests for this ingest key.",
      },
    });
  });

  it("includes structured details when the error carries them", async () => {
    const handler = withErrorHandler({ context: "test" }, async () => {
      throw new ApiError("VALIDATION_FAILED", "Invalid ingest payload.", {
        details: {
          issues: [{ path: "events.0.message", message: "Required" }],
        },
      });
    });

    const body = await (await handler(makeRequest())).json();

    expect(body.error.details).toEqual({
      issues: [{ path: "events.0.message", message: "Required" }],
    });
  });

  it("never serialises logContext into the response", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handler = withErrorHandler({ context: "test" }, async () => {
      throw new ApiError("UNAUTHORIZED", "Invalid ingest key.", {
        logContext: "key jfl_pub_secretvalue was revoked at 2026-01-01",
      });
    });

    const response = await handler(makeRequest());
    const raw = await response.text();

    expect(raw).not.toContain("jfl_pub_secretvalue");
    expect(raw).not.toContain("logContext");
    expect(warn).toHaveBeenCalled();
  });

  it("turns an unexpected error into a generic 500", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const handler = withErrorHandler({ context: "test" }, async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432 for user 'logger'");
    });

    const response = await handler(makeRequest());
    const raw = await response.text();

    expect(response.status).toBe(500);
    expect(raw).not.toContain("ECONNREFUSED");
    expect(raw).not.toContain("10.0.0.5");
    expect(JSON.parse(raw)).toEqual({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
    expect(error).toHaveBeenCalled();
  });

  it("never lets a thrown string escape as a body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = withErrorHandler({ context: "test" }, async () => {
      throw "raw secret string";
    });

    const raw = await (await handler(makeRequest())).text();

    expect(raw).not.toContain("raw secret string");
  });

  it("marks every response no-store", async () => {
    const handler = withErrorHandler({ context: "test" }, async () =>
      apiSuccess({ ok: true }),
    );

    const response = await handler(makeRequest());

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("attaches the failure headers the caller supplies", async () => {
    const handler = withErrorHandler(
      { context: "test", errorHeaders: () => ({ vary: "Origin" }) },
      async () => {
        throw new ApiError("FORBIDDEN", "Nope.");
      },
    );

    const response = await handler(makeRequest());

    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("passes through a plain NextResponse the handler builds", async () => {
    const handler = withErrorHandler(
      { context: "test" },
      async () => new NextResponse(null, { status: 204 }),
    );

    expect((await handler(makeRequest())).status).toBe(204);
  });
});
