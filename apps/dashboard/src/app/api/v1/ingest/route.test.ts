import {
  EMPTY_MESSAGE_PLACEHOLDER,
  INGEST_KEY_HEADER,
  MAX_BODY_BYTES,
} from "@stuffs-logger/core";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import {
  INVALID_KEY_MAX_REFUSALS,
  INVALID_KEY_WINDOW_MS,
  resetInvalidKeyThrottle,
} from "@/lib/ingest/invalid-key-throttle";
import { hashIngestSecret } from "@/lib/ingest/keys";
import { resetOriginRegistrySnapshot } from "@/lib/ingest/origin-registry";
import { DAILY_EVENT_QUOTA } from "@/lib/ingest/quota";
import { resetRateLimits } from "@/lib/ingest/rate-limit";
import { resetSecretKeyExposureWarnings } from "@/lib/ingest/secret-key-exposure";
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

const INGEST_URL = "https://logger.example.test/api/v1/ingest";
const ORIGIN = "https://app.example.test";
const PUBLIC_KEY = `slg_pub_${"p".repeat(32)}`;
const SECRET_KEY_ID = "lookuphandle1234";
const SECRET_SEGMENT = "s".repeat(32);
const SECRET_KEY = `slg_sec_${SECRET_KEY_ID}_${SECRET_SEGMENT}`;
const APPLICATION_ID = "app-1";
const CLIENT_IP = "203.0.113.9";

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

function secretKeyRow() {
  return {
    id: "key-2",
    applicationId: APPLICATION_ID,
    type: "SECRET" as const,
    publicKey: null,
    keyId: SECRET_KEY_ID,
    secretHash: hashIngestSecret(SECRET_SEGMENT),
    allowedOrigins: [],
    revokedAt: null,
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

/** The headers every request carries unless a test overrides or removes one. */
const DEFAULT_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: ORIGIN,
  [INGEST_KEY_HEADER]: PUBLIC_KEY,
};

/** Merges overrides into the defaults; a `null` override REMOVES the header. */
function requestHeaders(
  overrides: Record<string, string | null>,
): Record<string, string> {
  const merged: Record<string, string | null> = {
    ...DEFAULT_HEADERS,
    ...overrides,
  };

  return Object.fromEntries(
    Object.entries(merged).filter(
      (entry): entry is [string, string] => entry[1] !== null,
    ),
  );
}

function makeRequest(
  body: unknown,
  headers: Record<string, string | null> = {},
): Request {
  return new Request(INGEST_URL, {
    method: "POST",
    headers: requestHeaders(headers),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A request whose body arrives as a stream, with no `content-length`. */
function makeStreamRequest(body: ReadableStream<Uint8Array>): Request {
  // Node's fetch requires `duplex: "half"` for a streaming request body, and
  // the DOM lib's `RequestInit` does not declare it, so the init is typed on
  // its own rather than written inline where the extra key would be refused.
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: requestHeaders({}),
    body,
    duplex: "half",
  };

  return new Request(INGEST_URL, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  resetInvalidKeyThrottle();
  resetSecretKeyExposureWarnings();
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

  it("cancels a chunked body the moment it passes the limit, rather than draining it", async () => {
    const CHUNK_BYTES = 65_536;
    // Enough to prove a drain (4 MiB) and bounded so a regression cannot run
    // away; the pass condition is far below it.
    const MAX_PULLS = 64;
    let pulls = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > MAX_PULLS) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(CHUNK_BYTES).fill(0x20));
      },
      cancel() {
        cancelled = true;
      },
    });

    const response = await POST(makeStreamRequest(endless));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
    expect(cancelled).toBe(true);
    // One pull per chunk read before the limit tripped, plus the stream's own
    // one-chunk read-ahead. Draining would have taken all MAX_PULLS.
    expect(pulls).toBeLessThanOrEqual(
      Math.ceil(MAX_BODY_BYTES / CHUNK_BYTES) + 2,
    );
  });

  it("accepts a chunked body under the limit, decoded across chunk boundaries", async () => {
    // A multi-byte character split across two chunks must decode as itself.
    const bytes = new TextEncoder().encode(
      JSON.stringify(
        batch({
          events: [
            {
              ts: Date.now(),
              level: "info",
              message: "héllo",
              logger: "manual",
            },
          ],
        }),
      ),
    );
    const splitAt = bytes.indexOf(0xc3) + 1;
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        controller.close();
      },
    });

    const response = await POST(makeStreamRequest(chunked));

    expect(response.status).toBe(202);
    const rows = vi.mocked(insertLogEvents).mock.calls[0]?.[0];
    expect(rows?.[0]?.message).toBe("héllo");
  });

  it("refuses a request with no body at all with 400", async () => {
    const response = await POST(
      new Request(INGEST_URL, { method: "POST", headers: requestHeaders({}) }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
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

  it("sanitises the envelope labels and an all-control message before writing", async () => {
    const NUL = String.fromCodePoint(0x00);
    const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);

    await POST(
      makeRequest(
        batch({
          environment: `prod${RIGHT_TO_LEFT_OVERRIDE}uction`,
          events: [
            { ts: Date.now(), level: "info", message: NUL, logger: "manual" },
          ],
        }),
      ),
    );

    const rows = vi.mocked(insertLogEvents).mock.calls[0]?.[0];
    expect(rows?.[0]).toMatchObject({
      environment: "production",
      message: EMPTY_MESSAGE_PLACEHOLDER,
    });
  });

  describe("invalid-key throttle", () => {
    /** Sends `count` requests with an unknown key from `clientIp`. */
    async function spray(
      count: number,
      clientIp: string | null,
    ): Promise<void> {
      for (let attempt = 0; attempt < count; attempt += 1) {
        await POST(makeRequest(batch(), { "x-forwarded-for": clientIp }));
      }
    }

    beforeEach(() => {
      vi.mocked(prismaIngestKeyStore.findPublicKey).mockResolvedValue(null);
    });

    it("stops looking up keys for an address once its allowance is spent", async () => {
      await spray(INVALID_KEY_MAX_REFUSALS, CLIENT_IP);
      expect(prismaIngestKeyStore.findPublicKey).toHaveBeenCalledTimes(
        INVALID_KEY_MAX_REFUSALS,
      );

      const response = await POST(
        makeRequest(batch(), { "x-forwarded-for": CLIENT_IP }),
      );

      expect(response.status).toBe(429);
      expect(prismaIngestKeyStore.findPublicKey).toHaveBeenCalledTimes(
        INVALID_KEY_MAX_REFUSALS,
      );
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "RATE_LIMITED",
          details: { retryAfterSeconds: expect.any(Number) },
        },
      });
    });

    it("grants nothing to a throttled address — Vary: Origin only", async () => {
      await spray(INVALID_KEY_MAX_REFUSALS, CLIENT_IP);

      const response = await POST(
        makeRequest(batch(), { "x-forwarded-for": CLIENT_IP }),
      );

      expect(response.headers.get("vary")).toBe("Origin");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("refuses even a valid key from a throttled address, until the window passes", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
        await spray(INVALID_KEY_MAX_REFUSALS, CLIENT_IP);
        vi.mocked(prismaIngestKeyStore.findPublicKey).mockResolvedValue(
          publicKeyRow(),
        );

        const during = await POST(
          makeRequest(batch(), { "x-forwarded-for": CLIENT_IP }),
        );
        expect(during.status).toBe(429);

        vi.setSystemTime(
          new Date("2026-09-01T12:00:00.000Z").getTime() +
            INVALID_KEY_WINDOW_MS,
        );
        const after = await POST(
          makeRequest(batch(), { "x-forwarded-for": CLIENT_IP }),
        );
        expect(after.status).toBe(202);
      } finally {
        vi.useRealTimers();
      }
    });

    it("throttles each address separately", async () => {
      await spray(INVALID_KEY_MAX_REFUSALS, CLIENT_IP);
      vi.mocked(prismaIngestKeyStore.findPublicKey).mockResolvedValue(
        publicKeyRow(),
      );

      const response = await POST(
        makeRequest(batch(), { "x-forwarded-for": "198.51.100.4" }),
      );

      expect(response.status).toBe(202);
    });

    it("never throttles a request that carries no client address", async () => {
      await spray(INVALID_KEY_MAX_REFUSALS + 5, null);

      const response = await POST(
        makeRequest(batch(), { "x-forwarded-for": null }),
      );

      expect(response.status).toBe(401);
      expect(prismaIngestKeyStore.findPublicKey).toHaveBeenCalledTimes(
        INVALID_KEY_MAX_REFUSALS + 6,
      );
    });

    it("does not count origin refusals, which need a live key", async () => {
      vi.mocked(prismaIngestKeyStore.findPublicKey).mockResolvedValue(
        publicKeyRow(),
      );
      for (let attempt = 0; attempt < INVALID_KEY_MAX_REFUSALS; attempt += 1) {
        const refused = await POST(
          makeRequest(batch(), {
            "x-forwarded-for": CLIENT_IP,
            origin: "https://evil.example.test",
          }),
        );
        expect(refused.status).toBe(403);
      }

      const response = await POST(
        makeRequest(batch(), { "x-forwarded-for": CLIENT_IP }),
      );

      expect(response.status).toBe(202);
    });
  });

  describe("secret key exposure", () => {
    beforeEach(() => {
      vi.mocked(prismaIngestKeyStore.findSecretKeyByKeyId).mockResolvedValue(
        secretKeyRow(),
      );
    });

    function exposureWarnings(
      warn: MockInstance<typeof console.warn>,
    ): string[] {
      return warn.mock.calls
        .map((call) => String(call[0]))
        .filter((line) =>
          line.includes("secret key key-2 presented from a browser"),
        );
    }

    it("accepts a secret key from a browser but warns, once per minute", async () => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      const first = await POST(
        makeRequest(batch(), { [INGEST_KEY_HEADER]: SECRET_KEY }),
      );
      const second = await POST(
        makeRequest(batch(), { [INGEST_KEY_HEADER]: SECRET_KEY }),
      );

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(exposureWarnings(warn)).toHaveLength(1);
      expect(exposureWarnings(warn)[0]).toContain(JSON.stringify(ORIGIN));
    });

    it("does not warn about a secret key used from a server process", async () => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      const response = await POST(
        makeRequest(batch({ source: "node" }), {
          [INGEST_KEY_HEADER]: SECRET_KEY,
          origin: null,
        }),
      );

      expect(response.status).toBe(202);
      expect(exposureWarnings(warn)).toHaveLength(0);
    });
  });

  it("quotes and caps a hostile Origin in the refusal log line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hostile = `https://evil.example.test/"; forged="${"x".repeat(2000)}`;

    const response = await POST(makeRequest(batch(), { origin: hostile }));

    expect(response.status).toBe(403);
    const line = warn.mock.calls
      .map((call) => String(call[0]))
      .find((entry) => entry.includes("not on key allowlist"));
    expect(line).toBeDefined();
    expect(line).toContain('origin "https://evil.example.test/\\"; forged=');
    expect(line?.length).toBeLessThan(400);
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
