import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type { AppSession, AppUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db";

import { listApiTokens } from "./queries";

/**
 * The token listing's gate and projection. Only the database is mocked; the
 * access check runs for real and must refuse BEFORE any query is issued.
 */
vi.mock("@/lib/db", () => ({
  prisma: { apiToken: { findMany: vi.fn() } },
}));

function makeSession(overrides: Partial<AppUser> = {}): AppSession {
  return {
    user: {
      id: "user-1",
      email: "someone@makingstuffs.co.uk",
      name: "Someone",
      role: "ADMIN",
      image: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    },
    session: {
      id: "session-1",
      token: "token",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    },
  };
}

const STORED_DIGEST = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.apiToken.findMany).mockResolvedValue([
    {
      id: "token-1",
      name: "Retention cron",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastUsedAt: new Date("2026-01-15T03:00:01.000Z"),
      revokedAt: null,
      // What a careless select would hand back. The DTO must not carry it on.
      tokenHash: STORED_DIGEST,
    },
  ] as never);
});

describe("listApiTokens — access", () => {
  it.each([
    ["a MEMBER", makeSession({ role: "MEMBER" }), "FORBIDDEN"],
    ["a deactivated ADMIN", makeSession({ isActive: false }), "UNAUTHORIZED"],
    [
      "an anonymous session",
      makeSession({ id: "", email: "", isActive: false }),
      "UNAUTHORIZED",
    ],
  ])("refuses %s before querying", async (_label, session, code) => {
    const refusal = listApiTokens(session);

    await expect(refusal).rejects.toBeInstanceOf(ApiError);
    await expect(refusal).rejects.toMatchObject({ code });
    expect(prisma.apiToken.findMany).not.toHaveBeenCalled();
  });
});

describe("listApiTokens — projection", () => {
  it("never selects the stored digest", async () => {
    await listApiTokens(makeSession());

    const call = vi.mocked(prisma.apiToken.findMany).mock.calls[0]?.[0];

    expect(call?.select).toBeDefined();
    expect(call?.select).not.toHaveProperty("tokenHash");
  });

  it("returns DTOs with ISO dates and no digest", async () => {
    const tokens = await listApiTokens(makeSession());

    expect(tokens).toEqual([
      {
        id: "token-1",
        name: "Retention cron",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: "2026-01-15T03:00:01.000Z",
        revokedAt: null,
      },
    ]);
    expect(JSON.stringify(tokens)).not.toContain(STORED_DIGEST);
  });
});
