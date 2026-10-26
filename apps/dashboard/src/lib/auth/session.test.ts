import { redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOCK_SESSION } from "./mock-session";
import { getSession, getSessionOrRedirect, signOut } from "./session";

/**
 * The session seam, proved at its two boundaries.
 *
 * Better Auth is mocked because it IS the boundary — what these tests hold is
 * everything this app does around it: that a malformed or missing session
 * fails CLOSED, that a deactivated account is reported as its own reason
 * rather than laundered into a grant, that the page gate cannot be turned into
 * an open redirect, and that a deactivated user is not bounced into a sign-in
 * they have already completed.
 *
 * A FACTORY MOCK, not a spy: loading the real module would construct a Better
 * Auth instance and a Prisma client to answer questions that are about this
 * file's logic.
 */
const getBetterAuthSession = vi.fn();
const betterAuthSignOut = vi.fn();

vi.mock("./auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getBetterAuthSession(...args),
      signOut: (...args: unknown[]) => betterAuthSignOut(...args),
    },
  },
  isGoogleConfigured: () => false,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/navigation", () => ({
  // The real `redirect` signals by throwing; the double does too, so a test
  // cannot accidentally assert on code that would never have run.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

/** A resolved session exactly as Better Auth hands it back. */
function betterAuthSession(
  userOverrides: Record<string, unknown> = {},
): unknown {
  return {
    user: {
      id: "user-1",
      email: "someone@makingstuffs.co.uk",
      name: "Someone",
      role: "MEMBER",
      image: null,
      isActive: true,
      emailVerified: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...userOverrides,
    },
    session: {
      id: "session-1",
      token: "session-token",
      userId: "user-1",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ipAddress: null,
      userAgent: null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SKIP_AUTH;
  delete process.env.NEXT_PUBLIC_SKIP_AUTH;
});

afterEach(() => {
  delete process.env.SKIP_AUTH;
  delete process.env.NEXT_PUBLIC_SKIP_AUTH;
});

describe("getSession", () => {
  it("grants a live account", async () => {
    getBetterAuthSession.mockResolvedValue(betterAuthSession());

    const result = await getSession();

    expect(result.hasAccess).toBe(true);
    expect(result.hasAccess && result.session.user.role).toBe("MEMBER");
  });

  it("refuses when there is no session", async () => {
    getBetterAuthSession.mockResolvedValue(null);

    await expect(getSession()).resolves.toEqual({
      hasAccess: false,
      reason: "UNAUTHENTICATED",
      session: null,
    });
  });

  it("reports a deactivated account as INACTIVE, carrying the session", async () => {
    getBetterAuthSession.mockResolvedValue(
      betterAuthSession({ isActive: false }),
    );

    const result = await getSession();

    expect(result.hasAccess).toBe(false);
    expect(result).toMatchObject({ reason: "INACTIVE" });
    expect(result.hasAccess === false && result.session?.user.id).toBe(
      "user-1",
    );
  });

  it.each([
    ["a missing isActive flag", { isActive: undefined }],
    ["a role outside the vocabulary", { role: "SUPER_ADMIN" }],
    ["an empty user id", { id: "" }],
  ])("fails closed on %s", async (_name, overrides) => {
    getBetterAuthSession.mockResolvedValue(betterAuthSession(overrides));

    await expect(getSession()).resolves.toMatchObject({
      hasAccess: false,
      reason: "UNAUTHENTICATED",
      session: null,
    });
  });

  it("fails closed when resolving the session throws", async () => {
    getBetterAuthSession.mockRejectedValue(new Error("database unreachable"));

    await expect(getSession()).resolves.toMatchObject({
      hasAccess: false,
      reason: "UNAUTHENTICATED",
    });
  });

  it("never leaks the underlying failure to the caller", async () => {
    getBetterAuthSession.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.1:5432"),
    );

    const result = await getSession();

    expect(JSON.stringify(result)).not.toContain("10.0.0.1");
  });

  it("returns the mock session, with no I/O, when auth is skipped", async () => {
    process.env.SKIP_AUTH = "true";

    await expect(getSession()).resolves.toEqual({
      hasAccess: true,
      session: MOCK_SESSION,
    });
    expect(getBetterAuthSession).not.toHaveBeenCalled();
  });
});

describe("getSessionOrRedirect", () => {
  it("returns the session for a live account", async () => {
    getBetterAuthSession.mockResolvedValue(betterAuthSession());

    const session = await getSessionOrRedirect({ returnPath: "/logs" });

    expect(session.user.id).toBe("user-1");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends an anonymous visitor to the sign-in page, remembering where they were", async () => {
    getBetterAuthSession.mockResolvedValue(null);

    await expect(
      getSessionOrRedirect({ returnPath: "/logs?level=error" }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith(
      "/sign-in?returnTo=%2Flogs%3Flevel%3Derror",
    );
  });

  it("refuses an off-origin return path rather than emitting it", async () => {
    getBetterAuthSession.mockResolvedValue(null);

    await expect(
      getSessionOrRedirect({ returnPath: "https://evil.test/steal" }),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    const target = vi.mocked(redirect).mock.calls[0]?.[0];

    expect(target).toBe("/sign-in");
    expect(String(target)).not.toContain("evil.test");
  });

  it("refuses a return path that only leaves the origin once normalised", async () => {
    // `/..//evil.test` parses as a path on this app and normalises to
    // `//evil.test`, which `redirect()` would send to another host.
    getBetterAuthSession.mockResolvedValue(null);

    await expect(
      getSessionOrRedirect({ returnPath: "/..//evil.test" }),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    const target = vi.mocked(redirect).mock.calls[0]?.[0];

    expect(target).toBe("/sign-in");
    expect(String(target)).not.toContain("evil.test");
  });

  it("does not bounce a deactivated user into a sign-in they have completed", async () => {
    getBetterAuthSession.mockResolvedValue(
      betterAuthSession({ isActive: false }),
    );

    const session = await getSessionOrRedirect({ returnPath: "/" });

    // Returned so the page can render the refusal; the data-access gates are
    // what actually refuse the read.
    expect(session.user.isActive).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("revokes the session server-side", async () => {
    betterAuthSignOut.mockResolvedValue({ success: true });

    await signOut();

    expect(betterAuthSignOut).toHaveBeenCalledTimes(1);
  });

  it("never throws when revocation fails", async () => {
    betterAuthSignOut.mockRejectedValue(new Error("database unreachable"));

    await expect(signOut()).resolves.toBeUndefined();
  });

  it("does nothing when auth is skipped", async () => {
    process.env.SKIP_AUTH = "true";

    await signOut();

    expect(betterAuthSignOut).not.toHaveBeenCalled();
  });
});
