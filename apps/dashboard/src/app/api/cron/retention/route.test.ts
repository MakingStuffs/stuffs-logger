import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RETENTION_DELETE_BATCH_SIZE,
  RETENTION_MIN_RUN_INTERVAL_MS,
  RETENTION_TIME_BUDGET_MS,
  RETENTION_WINDOW_MS,
} from "@/constants/retention";
import { verifyApiToken } from "@/lib/auth/api-token";
import { prisma } from "@/lib/db";

import { GET } from "./route";

/**
 * The two refusals, the happy path, and the batch loop.
 *
 * `verifyApiToken` is the boundary and is mocked; nothing re-implements its
 * decision here, which is the point of the route deferring to it — the
 * decision itself has its own tests in `lib/auth/api-token.test.ts`. What is
 * asserted is what the ROUTE does with each arm: two different statuses, the
 * standard envelope on both, no work done on either, and no hint about which
 * check failed.
 *
 * The sweep is one `$executeRaw` per batch. The tests pin what was measured
 * against a 5M-row table — a single bounded statement with the cutoff and the
 * batch size bound as parameters — and the loop's two exits: a short batch
 * (done) and the time budget (deferred).
 */
vi.mock("@/lib/auth/api-token", () => ({ verifyApiToken: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { $executeRaw: vi.fn() },
}));

const NOW = new Date("2026-10-22T03:00:00.000Z");

function request(token = "slg_live_token"): Request {
  return new Request("https://logger.example.test/api/cron/retention", {
    headers: { authorization: `Bearer ${token}` },
  });
}

function acceptToken(): void {
  vi.mocked(verifyApiToken).mockResolvedValue({
    ok: true,
    token: { tokenId: "token-1", name: "Retention cron" },
  });
}

function refuseToken(reason: "invalid" | "rate_limited"): void {
  vi.mocked(verifyApiToken).mockResolvedValue({ ok: false, reason });
}

/** The bound values of the n-th `$executeRaw` tagged-template call. */
function executeRawValues(index = 0): unknown[] {
  const call = vi.mocked(prisma.$executeRaw).mock.calls[index];
  if (call === undefined) throw new Error(`no $executeRaw call #${index}`);
  return call.slice(1);
}

function executeRawSql(index = 0): string {
  const call = vi.mocked(prisma.$executeRaw).mock.calls[index];
  const strings = call?.[0];
  if (!Array.isArray(strings)) throw new Error("not a tagged template call");
  return strings.join("?");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(prisma.$executeRaw).mockResolvedValue(0);
});

afterEach(() => vi.useRealTimers());

describe("GET /api/cron/retention", () => {
  describe("refusals", () => {
    it("answers 401 in the standard envelope for an invalid credential", async () => {
      refuseToken("invalid");

      const response = await GET(request());

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid credentials." },
      });
    });

    it("answers 401 and deletes nothing when there is no Authorization header", async () => {
      refuseToken("invalid");

      const response = await GET(
        new Request("https://logger.example.test/api/cron/retention"),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid credentials." },
      });
      expect(verifyApiToken).toHaveBeenCalledWith("", expect.anything());
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it("presents an empty credential for a non-bearer scheme", async () => {
      refuseToken("invalid");

      const response = await GET(
        new Request("https://logger.example.test/api/cron/retention", {
          headers: { authorization: "Basic c2xnOnRva2Vu" },
        }),
      );

      expect(response.status).toBe(401);
      expect(verifyApiToken).toHaveBeenCalledWith("", expect.anything());
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it("answers 429 in the standard envelope when it ran too recently", async () => {
      refuseToken("rate_limited");

      const response = await GET(request());

      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: { code: "RATE_LIMITED" },
      });
    });

    it("deletes nothing inside the minimum interval, even with a good credential", async () => {
      refuseToken("rate_limited");

      await GET(request());

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it("never says which check failed", async () => {
      refuseToken("invalid");

      const body = await (await GET(request())).json();

      expect(JSON.stringify(body)).not.toMatch(/revoked|expired|unknown|app/i);
    });

    it("deletes nothing when the credential is refused", async () => {
      refuseToken("invalid");

      await GET(request());

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it("hands the throttle to the verifier rather than enforcing it here", async () => {
      refuseToken("invalid");

      await GET(request());

      // The interval is claimed atomically inside `verifyApiToken`; a
      // read-then-decide guard in this route could not serialise concurrent
      // presentations.
      expect(verifyApiToken).toHaveBeenCalledWith(
        "slg_live_token",
        expect.objectContaining({
          minIntervalMs: RETENTION_MIN_RUN_INTERVAL_MS,
        }),
      );
    });
  });

  describe("sweep", () => {
    it("deletes in bounded single statements until a batch comes up short", async () => {
      acceptToken();
      vi.mocked(prisma.$executeRaw)
        .mockResolvedValueOnce(RETENTION_DELETE_BATCH_SIZE)
        .mockResolvedValueOnce(RETENTION_DELETE_BATCH_SIZE)
        .mockResolvedValueOnce(120);

      const response = await GET(request());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        data: {
          deleted: RETENTION_DELETE_BATCH_SIZE * 2 + 120,
          complete: true,
          batches: 3,
        },
      });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
    });

    it("binds the cutoff and the batch size as parameters of one DELETE", async () => {
      acceptToken();

      await GET(request());

      const cutoff = new Date(NOW.getTime() - RETENTION_WINDOW_MS);
      expect(executeRawValues()).toEqual([cutoff, RETENTION_DELETE_BATCH_SIZE]);
      expect(executeRawSql()).toMatch(/^\s*DELETE FROM "log_events"/);
      expect(executeRawSql()).toContain("ctid");
      expect(executeRawSql()).toContain('"receivedAt" < ?');
      expect(executeRawSql()).toContain("LIMIT ?");
    });

    it("reports the cutoff it deleted before", async () => {
      acceptToken();

      const body = await (await GET(request())).json();

      expect(body.data.cutoff).toBe(
        new Date(NOW.getTime() - RETENTION_WINDOW_MS).toISOString(),
      );
    });

    it("stops at the time budget and reports the remainder as deferred", async () => {
      acceptToken();
      // Every batch is full and each one eats half the budget, so the third
      // would start past it.
      vi.mocked(prisma.$executeRaw).mockImplementation(() => {
        vi.advanceTimersByTime(RETENTION_TIME_BUDGET_MS / 2);
        return Promise.resolve(RETENTION_DELETE_BATCH_SIZE) as never;
      });

      const response = await GET(request());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        data: {
          deleted: RETENTION_DELETE_BATCH_SIZE * 2,
          complete: false,
          batches: 2,
        },
      });
    });

    it("answers one fixed 500 when the sweep itself fails", async () => {
      acceptToken();
      vi.mocked(prisma.$executeRaw).mockRejectedValue(
        new Error("connection to database failed at 10.0.0.1:5432"),
      );

      const response = await GET(request());

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        },
      });
      expect(JSON.stringify(body)).not.toContain("10.0.0.1");
    });
  });
});
