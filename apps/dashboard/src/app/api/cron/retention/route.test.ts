import { beforeEach, describe, expect, it, vi } from "vitest";

import { RETENTION_MIN_RUN_INTERVAL_MS } from "@/constants/retention";
import { verifyApiToken } from "@/lib/auth/api-token";
import { prisma } from "@/lib/db";

import { GET } from "./route";

/**
 * The two refusals and the happy path.
 *
 * `verifyApiToken` is the boundary and is mocked; nothing re-implements its
 * decision here, which is the point of the route deferring to it — the
 * decision itself has its own tests in `lib/auth/api-token.test.ts`. What is
 * asserted is what the ROUTE does with each arm: two different statuses, the
 * standard envelope on both, no work done on either, and no hint about which
 * check failed.
 */
vi.mock("@/lib/auth/api-token", () => ({ verifyApiToken: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    logEvent: { findMany: vi.fn(), deleteMany: vi.fn() },
  },
}));

function request(token = "slg_live_token"): Request {
  return new Request("https://logger.example.test/api/cron/retention", {
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.logEvent.findMany).mockResolvedValue([]);
  vi.mocked(prisma.logEvent.deleteMany).mockResolvedValue({ count: 0 });
});

describe("GET /api/cron/retention", () => {
  it("answers 401 in the standard envelope for an invalid credential", async () => {
    vi.mocked(verifyApiToken).mockResolvedValue({
      ok: false,
      reason: "invalid",
    });

    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Invalid credentials." },
    });
  });

  it("answers 429 in the standard envelope when it ran too recently", async () => {
    vi.mocked(verifyApiToken).mockResolvedValue({
      ok: false,
      reason: "rate_limited",
    });

    const response = await GET(request());

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "RATE_LIMITED" },
    });
  });

  it("never says which check failed", async () => {
    vi.mocked(verifyApiToken).mockResolvedValue({
      ok: false,
      reason: "invalid",
    });

    const body = await (await GET(request())).json();

    expect(JSON.stringify(body)).not.toMatch(/revoked|expired|unknown|app/i);
  });

  it("deletes nothing when the credential is refused", async () => {
    vi.mocked(verifyApiToken).mockResolvedValue({
      ok: false,
      reason: "invalid",
    });

    await GET(request());

    expect(prisma.logEvent.deleteMany).not.toHaveBeenCalled();
  });

  it("hands the throttle to the verifier rather than enforcing it here", async () => {
    vi.mocked(verifyApiToken).mockResolvedValue({
      ok: false,
      reason: "invalid",
    });

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

  it("presents no token at all when the header is missing", async () => {
    vi.mocked(verifyApiToken).mockResolvedValue({
      ok: false,
      reason: "invalid",
    });

    await GET(new Request("https://logger.example.test/api/cron/retention"));

    expect(verifyApiToken).toHaveBeenCalledWith("", expect.anything());
  });

  it("sweeps and reports in the standard envelope for a valid credential", async () => {
    vi.mocked(verifyApiToken).mockResolvedValue({
      ok: true,
      token: { tokenId: "token-1", name: "Retention cron" },
    });
    vi.mocked(prisma.logEvent.findMany)
      .mockResolvedValueOnce([{ id: "event-1" }] as never)
      .mockResolvedValue([]);
    vi.mocked(prisma.logEvent.deleteMany).mockResolvedValue({ count: 1 });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { deleted: 1, complete: true },
    });
  });

  it("answers one fixed 500 when the sweep itself fails", async () => {
    vi.mocked(verifyApiToken).mockResolvedValue({
      ok: true,
      token: { tokenId: "token-1", name: "Retention cron" },
    });
    vi.mocked(prisma.logEvent.findMany).mockRejectedValue(
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
