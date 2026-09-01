import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INGEST_KEY_HEADER, MAX_BODY_BYTES } from "../contract";
import { SECRET_KEY } from "../testing/fixtures";
import { createHttpTransport } from "./transport";
import type { IngestBatch } from "../contract";

const ENDPOINT = "https://logs.example.com/api/v1/ingest";

function makeBatch(events = 1): IngestBatch {
  return {
    sdk: { name: "@stuffs-logger/sdk", version: "0.1.0" },
    environment: "test",
    source: "node",
    events: Array.from({ length: events }, (_unused, index) => ({
      ts: 1_767_000_000_000,
      level: "info" as const,
      message: `event ${index}`,
      logger: "manual" as const,
    })),
  };
}

function respond(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, { status, headers });
}

describe("createHttpTransport", () => {
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    request = vi.fn().mockResolvedValue(respond(202));
    vi.stubGlobal("fetch", request);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function transport(report = vi.fn()) {
    return createHttpTransport({
      endpoint: ENDPOINT,
      apiKey: SECRET_KEY,
      report,
    });
  }

  it("posts the batch with the ingest key header", async () => {
    await transport().send({ batch: makeBatch(), urgent: false });

    expect(request).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          [INGEST_KEY_HEADER]: SECRET_KEY,
        }),
      }),
    );
  });

  it("never sends the caller's cookies to the ingest endpoint", async () => {
    await transport().send({ batch: makeBatch(), urgent: false });

    expect(request.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit" });
  });

  it("uses keepalive only on the unload path", async () => {
    await transport().send({ batch: makeBatch(), urgent: true });
    expect(request.mock.calls[0]?.[1]).toMatchObject({ keepalive: true });

    await transport().send({ batch: makeBatch(), urgent: false });
    expect(request.mock.calls[1]?.[1]).toMatchObject({ keepalive: false });
  });

  it("reports a successful send", async () => {
    const outcome = await transport().send({
      batch: makeBatch(3),
      urgent: false,
    });

    expect(outcome).toEqual({ kind: "sent", accepted: 3 });
  });

  it("disables itself when the key is refused", async () => {
    for (const status of [401, 403]) {
      request.mockResolvedValueOnce(respond(status));

      const outcome = await transport().send({
        batch: makeBatch(),
        urgent: false,
      });

      expect(outcome.kind, `status ${status}`).toBe("disabled");
    }
  });

  it("drops a batch the server condemns", async () => {
    for (const status of [400, 413]) {
      request.mockResolvedValueOnce(respond(status));

      const outcome = await transport().send({
        batch: makeBatch(),
        urgent: false,
      });

      expect(outcome.kind, `status ${status}`).toBe("dropped");
    }
  });

  it("retries a rate limit, honouring Retry-After", async () => {
    request.mockResolvedValueOnce(respond(429, { "retry-after": "30" }));

    const outcome = await transport().send({
      batch: makeBatch(),
      urgent: false,
    });

    expect(outcome).toEqual({ kind: "retry", retryAfterMs: 30000 });
  });

  it("retries a server error", async () => {
    request.mockResolvedValueOnce(respond(503));

    expect(
      (await transport().send({ batch: makeBatch(), urgent: false })).kind,
    ).toBe("retry");
  });

  it("retries an opaque network failure rather than throwing", async () => {
    const report = vi.fn();
    request.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const outcome = await transport(report).send({
      batch: makeBatch(),
      urgent: false,
    });

    expect(outcome).toEqual({ kind: "retry" });
    expect(report).toHaveBeenCalled();
  });

  it("measures the body in UTF-8 bytes, not UTF-16 code units", async () => {
    // 100,000 code units of CJK is 300,000 UTF-8 bytes — over the server's
    // limit, and the server is the one that measures bytes.
    const batch = makeBatch();
    batch.events[0] = {
      ...makeBatch().events[0]!,
      message: "\u6f22".repeat(100_000),
    };

    const outcome = await transport().send({ batch, urgent: false });

    expect(outcome.kind).toBe("dropped");
    expect(request).not.toHaveBeenCalled();
  });

  it("sends multi-byte content that fits the byte limit", async () => {
    const batch = makeBatch();
    batch.events[0] = {
      ...makeBatch().events[0]!,
      message: "\u6f22".repeat(20_000),
    };

    const outcome = await transport().send({ batch, urgent: false });

    expect(outcome.kind).toBe("sent");
    const body = request.mock.calls[0]?.[1]?.body as string;
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(
      MAX_BODY_BYTES,
    );
  });

  it("refuses an unload batch whose multi-byte content busts the keepalive budget", async () => {
    const batch = makeBatch();
    batch.events[0] = {
      ...makeBatch().events[0]!,
      message: "\u6f22".repeat(30_000),
    };

    const outcome = await transport().send({ batch, urgent: true });

    expect(outcome.kind).toBe("dropped");
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses an unload batch too large for the keepalive budget", async () => {
    const batch = makeBatch();
    batch.events[0] = { ...makeBatch().events[0]!, message: "x".repeat(70000) };

    const outcome = await transport().send({ batch, urgent: true });

    expect(outcome.kind).toBe("dropped");
    expect(request).not.toHaveBeenCalled();
  });

  it("names the keepalive cap when the batch would fit an ordinary flush", async () => {
    // Over the 64 KiB keepalive cap, well under the server's 256 KiB: the
    // caller can put this batch back rather than destroy it.
    const batch = makeBatch();
    batch.events[0] = { ...makeBatch().events[0]!, message: "x".repeat(70000) };

    const outcome = await transport().send({ batch, urgent: true });

    expect(outcome).toEqual({
      kind: "dropped",
      reason: expect.any(String),
      cause: "urgent-body-limit",
    });
  });

  it("names no cause for an unload batch that busts the server limit too", async () => {
    // Requeueing this one would only fail again on the ordinary path, so the
    // drop must stay final.
    const batch = makeBatch();
    batch.events[0] = {
      ...makeBatch().events[0]!,
      message: "x".repeat(MAX_BODY_BYTES + 1),
    };

    const outcome = await transport().send({ batch, urgent: true });

    expect(outcome).toEqual({ kind: "dropped", reason: expect.any(String) });
  });

  it("disables itself where there is no fetch at all", async () => {
    vi.stubGlobal("fetch", undefined);

    const outcome = await transport().send({
      batch: makeBatch(),
      urgent: false,
    });

    expect(outcome.kind).toBe("disabled");
  });
});
