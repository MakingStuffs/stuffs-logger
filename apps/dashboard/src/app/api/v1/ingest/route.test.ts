import { INGEST_KEY_HEADER, MAX_BODY_BYTES } from "@stuffs-logger/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetOriginRegistrySnapshot } from "@/lib/ingest/origin-registry";
import { DAILY_EVENT_QUOTA } from "@/lib/ingest/quota";
import { resetRateLimits } from "@/lib/ingest/rate-limit";
import {
  insertLogEvents,
  listRegisteredOrigins,
  prismaApplicationUsageStore,
  prismaIngestKeyStore,
  stampKeyLastUsed,
} from "@/lib/ingest/store";

import { OPTIONS, POST } from "./route";

/**
 * The handler, end to end, with only the database boundary mocked.
 *
 * Every control this endpoint has — the order of the checks, which refusals
 * carry CORS headers, the key-class rule, the body ceiling, the two 429s —
 * runs for real here. They are individually unit-tested; this file is what
 * proves they are actually WIRED, and wired in the right order.
 */
vi.mock("@/lib/ingest/store", () => ({
  prismaIngestKeyStore: {
    findPublicKey: vi.fn(),
    findSecretKeyByKeyId: vi.fn(),
  },
  prismaApplicationUsageStore: { increment: vi.fn() },
  insertLogEvents: vi.fn(),
  listRegisteredOrigins: vi.fn(),
  stampKeyLastUsed: vi.fn(),
}));

const ORIGIN = "https://app.example.test";
const PUBLIC_KEY = `slg_pub_${"p".repeat(32)}`;
const APPLICATION_ID = "app-1";

function publicKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    applicationId: APPLICATION_ID,
    type: "PUBLIC" as const,
    publicKey: PUBLIC_KEY,
    keyId: null,
    secretHash: null,
    allowedOrigins: [ORIGIN],
    revokedAt: null,
    ...overrides,
  };
}

function batch(overrides: Record<string, unknown> = {}) {
  return {
    sdk: { name: "@stuffs-logger/sdk", version: "0.1.0" },
    environment: "production",
    source: "browser",
    events: [
      { ts: Date.now(), level: "info", message: "hello", logger: "manual" },
    ],
    ...overrides,
  };
}

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://logger.example.test/api/v1/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      [INGEST_KEY_HEADER]: PUBLIC_KEY,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  resetOriginRegistrySnapshot();

  vi.mocked(prismaIngestKeyStore.findPublicKey).mockResolvedValue(
    publicKeyRow(),
  );
  vi.mocked(prismaIngestKeyStore.findSecretKeyByKeyId).mockResolvedValue(null);
  vi.mocked(prismaApplicationUsageStore.increment).mockResolvedValue({
    eventCount: 1,
    byteCount: 100,
  });
  vi.mocked(insertLogEvents).mockResolvedValue(1);
  vi.mocked(stampKeyLastUsed).mockResolvedValue(undefined);
  vi.mocked(listRegisteredOrigins).mockResolvedValue([ORIGIN]);
});

describe("POST /api/v1/ingest", () => {
  it("accepts a valid batch with 202 and the matched origin echoed", async () => {
    const response = await POST(makeRequest(batch()));

    expect(response.status).toBe(202);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { accepted: 1, rejected: 0 },
    });
  });

  it("checks the credential BEFORE reading the body", async () => {
    vi.mocked(prismaIngestKeyStore.findPublicKey).mockResolvedValue(null);

    // Unparseable body: if it were read first, this would be a 400.
    const response = await POST(makeRequest("{not json"));

    expect(response.status).toBe(401);
  });

  it("refuses an unknown key with 401 and no origin grant", async () => {
    vi.mocked(prismaIngestKeyStore.findPublicKey).mockResolvedValue(null);

    const response = await POST(makeRequest(batch()));

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("refuses a revoked key with 401", async () => {
    vi.mocked(prismaIngestKeyStore.findPublicKey).mockResolvedValue(
      publicKeyRow({ revokedAt: new Date() }),
    );

    expect((await POST(makeRequest(batch()))).status).toBe(401);
  });

  it("refuses an origin that is not on the key's allowlist with 403", async () => {
    const response = await POST(
      makeRequest(batch(), { origin: "https://evil.example.test" }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses a public key presented for a node batch with 403", async () => {
    const response = await POST(makeRequest(batch({ source: "node" })));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("never writes a batch it refused", async () => {
    await POST(makeRequest(batch({ source: "node" })));

    expect(insertLogEvents).not.toHaveBeenCalled();
  });

  it("refuses an oversized advertised body with 413, before buffering it", async () => {
    const response = await POST(
      makeRequest(batch(), {
        "content-length": String(MAX_BODY_BYTES + 1),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });

  it("refuses an oversized actual body with 413 when the header lied", async () => {
    const huge = batch({
      events: [
        {
          ts: Date.now(),
          level: "info",
          message: "x".repeat(8000),
          logger: "manual",
        },
      ],
    });
    const padded = JSON.stringify(huge).padEnd(MAX_BODY_BYTES + 10, " ");

    expect((await POST(makeRequest(padded))).status).toBe(413);
  });

  it("refuses a body that is not JSON with 400", async () => {
    const response = await POST(makeRequest("{not json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("rate limits a flood with 429 and a Retry-After the browser can read", async () => {
    let response = await POST(makeRequest(batch()));

    for (let attempt = 0; attempt < 130 && response.status !== 429; attempt++) {
      response = await POST(makeRequest(batch()));
    }

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).not.toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
  });

  it("refuses with QUOTA_EXCEEDED once the application's day is spent", async () => {
    vi.mocked(prismaApplicationUsageStore.increment).mockResolvedValue({
      eventCount: DAILY_EVENT_QUOTA + 1,
      byteCount: 100,
    });

    const response = await POST(makeRequest(batch()));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).not.toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "QUOTA_EXCEEDED" },
    });
    expect(insertLogEvents).not.toHaveBeenCalled();
  });

  it("counts the batch against the quota exactly once", async () => {
    await POST(
      makeRequest(
        batch({
          events: Array.from({ length: 5 }, () => ({
            ts: Date.now(),
            level: "info",
            message: "hello",
            logger: "manual",
          })),
        }),
      ),
    );

    expect(prismaApplicationUsageStore.increment).toHaveBeenCalledTimes(1);
    expect(prismaApplicationUsageStore.increment).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        delta: expect.objectContaining({ events: 5 }),
      }),
    );
  });

  it("attributes rows to the key's application, not the body", async () => {
    await POST(makeRequest(batch({ environment: "production" })));

    const rows = vi.mocked(insertLogEvents).mock.calls[0]?.[0];
    expect(rows?.[0]?.applicationId).toBe(APPLICATION_ID);
  });

  it("reports a malformed event without discarding the batch", async () => {
    const response = await POST(
      makeRequest(
        batch({
          events: [
            { ts: Date.now(), level: "info", message: "ok", logger: "manual" },
            { ts: Date.now(), level: "nope", message: "", logger: "manual" },
          ],
        }),
      ),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      data: { accepted: 1, rejected: 1 },
    });
  });
});

describe("OPTIONS /api/v1/ingest", () => {
  function preflight(headers: Record<string, string> = {}): Request {
    return new Request("https://logger.example.test/api/v1/ingest", {
      method: "OPTIONS",
      headers: { origin: ORIGIN, ...headers },
    });
  }

  it("grants a registered origin", async () => {
    const response = await OPTIONS(preflight());

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("grants nothing to an unregistered origin", async () => {
    vi.mocked(listRegisteredOrigins).mockResolvedValue([]);

    const response = await OPTIONS(preflight());

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("grants nothing when there is no Origin header", async () => {
    const response = await OPTIONS(
      new Request("https://logger.example.test/api/v1/ingest", {
        method: "OPTIONS",
      }),
    );

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(listRegisteredOrigins).not.toHaveBeenCalled();
  });

  it("does not query the database for every repeat preflight", async () => {
    await OPTIONS(preflight());
    await OPTIONS(preflight());
    await OPTIONS(preflight());

    expect(listRegisteredOrigins).toHaveBeenCalledTimes(1);
  });

  it("does not query the database for a spray of unknown origins", async () => {
    for (let index = 0; index < 100; index += 1) {
      await OPTIONS(preflight({ origin: `https://o${index}.example.test` }));
    }

    expect(listRegisteredOrigins).toHaveBeenCalledTimes(1);
  });

  it("keeps refusing, and keeps Vary, when the registry read fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(listRegisteredOrigins).mockRejectedValue(new Error("db is down"));

    const response = await OPTIONS(preflight());

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")).toBe("Origin");
  });
});
