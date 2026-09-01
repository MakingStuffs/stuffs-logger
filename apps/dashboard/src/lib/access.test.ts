import { describe, expect, it } from "vitest";

import { assertActiveViewer, assertAdminViewer } from "./access";
import { ApiError } from "./api/errors";
import type { AppSession, AppUser } from "./auth/types";

/**
 * The two gates, exercised for real.
 *
 * Nothing is mocked: the role predicate is the whole subject of these tests
 * and a mock would only prove the mock agrees with itself. The fixtures vary
 * exactly the two things a decision may depend on — the role, and whether the
 * account is live.
 */
function makeSession(overrides: Partial<AppUser> = {}): AppSession {
  return {
    user: {
      id: "user-1",
      email: "someone@makingstuffs.co.uk",
      name: "Someone",
      role: "MEMBER",
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

/**
 * The anonymous caller.
 *
 * There is no "no session" arm in these signatures — a call site with no
 * session cannot compile — so the closest reachable state is a session object
 * with no identity behind it, which must be refused like any other.
 */
const ANONYMOUS_SESSION = makeSession({ id: "", email: "", isActive: false });

describe("assertActiveViewer", () => {
  it.each(["MEMBER", "ADMIN"] as const)("allows a live %s", (role) => {
    expect(() => assertActiveViewer(makeSession({ role }))).not.toThrow();
  });

  it("refuses an anonymous caller with UNAUTHORIZED", () => {
    try {
      assertActiveViewer(ANONYMOUS_SESSION);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("UNAUTHORIZED");
      expect((error as ApiError).status).toBe(401);
    }
  });

  it("refuses a deactivated user with UNAUTHORIZED", () => {
    try {
      assertActiveViewer(makeSession({ isActive: false }));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ApiError).code).toBe("UNAUTHORIZED");
    }
  });

  it("refuses a deactivated ADMIN too — the role does not survive it", () => {
    expect(() =>
      assertActiveViewer(makeSession({ role: "ADMIN", isActive: false })),
    ).toThrow(ApiError);
  });

  it("never puts the user id in the client-facing message", () => {
    try {
      assertActiveViewer(makeSession({ isActive: false, id: "user-secret" }));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ApiError).message).not.toContain("user-secret");
      expect((error as ApiError).logContext).toContain("user-secret");
    }
  });
});

describe("assertAdminViewer", () => {
  it("allows a live ADMIN", () => {
    expect(() =>
      assertAdminViewer(makeSession({ role: "ADMIN" })),
    ).not.toThrow();
  });

  it("refuses a MEMBER with FORBIDDEN", () => {
    try {
      assertAdminViewer(makeSession({ role: "MEMBER" }));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("FORBIDDEN");
      expect((error as ApiError).status).toBe(403);
    }
  });

  it("refuses a deactivated ADMIN with UNAUTHORIZED, not FORBIDDEN", () => {
    try {
      assertAdminViewer(makeSession({ role: "ADMIN", isActive: false }));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ApiError).code).toBe("UNAUTHORIZED");
    }
  });

  it("refuses an anonymous caller", () => {
    expect(() => assertAdminViewer(ANONYMOUS_SESSION)).toThrow(ApiError);
  });

  it("does not treat a makingstuffs.co.uk address as admin on its own", () => {
    const session = makeSession({
      role: "MEMBER",
      email: "contractor@makingstuffs.co.uk",
    });

    expect(() => assertAdminViewer(session)).toThrow(ApiError);
  });

  it("never puts the user id in the client-facing message", () => {
    try {
      assertAdminViewer(makeSession({ role: "MEMBER", id: "user-secret" }));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ApiError).message).not.toContain("user-secret");
      expect((error as ApiError).logContext).toContain("user-secret");
    }
  });
});
