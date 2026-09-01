import type { SalientSession } from "@journey-further/salient-auth/server";
import { describe, expect, it } from "vitest";

import { assertInternalViewer } from "./access";
import { ApiError } from "./api/errors";

/**
 * `isInternalUser` is exercised for real rather than mocked: it is the whole
 * subject of these tests, and a mock would only prove the mock agrees with
 * itself. It derives internality from SCOPE, so the fixtures vary scope.
 */
function makeSession(
  overrides: Partial<SalientSession["user"]> = {},
): SalientSession {
  return {
    user: {
      id: "user-1",
      email: "someone@journeyfurther.com",
      name: "Someone",
      scope: "INTERNAL_USER",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      clients: [],
      accounts: [],
      apps: [],
      appConfigData: null,
      ...overrides,
    },
    session: {
      id: "session-1",
      token: "token",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

describe("assertInternalViewer", () => {
  it.each(["INTERNAL_USER", "INTERNAL_ADMIN", "SUPER_ADMIN"] as const)(
    "allows an internal %s",
    (scope) => {
      expect(() => assertInternalViewer(makeSession({ scope }))).not.toThrow();
    },
  );

  it.each(["CLIENT_USER", "CLIENT_ADMIN"] as const)("refuses a %s", (scope) => {
    expect(() => assertInternalViewer(makeSession({ scope }))).toThrow(
      ApiError,
    );
  });

  it("refuses a client scope with FORBIDDEN", () => {
    try {
      assertInternalViewer(makeSession({ scope: "CLIENT_USER" }));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ApiError).code).toBe("FORBIDDEN");
      expect((error as ApiError).status).toBe(403);
    }
  });

  it("refuses a deactivated user with UNAUTHORIZED, not FORBIDDEN", () => {
    try {
      assertInternalViewer(makeSession({ isActive: false }));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("UNAUTHORIZED");
      expect((error as ApiError).status).toBe(401);
    }
  });

  it("never puts the user id in the client-facing message", () => {
    try {
      assertInternalViewer(makeSession({ isActive: false, id: "user-secret" }));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ApiError).message).not.toContain("user-secret");
      expect((error as ApiError).logContext).toContain("user-secret");
    }
  });

  it("refuses a deactivated internal user before considering scope", () => {
    try {
      assertInternalViewer(
        makeSession({ scope: "SUPER_ADMIN", isActive: false }),
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ApiError).code).toBe("UNAUTHORIZED");
    }
  });

  it("does not treat a journeyfurther.com address as internal on its own", () => {
    const session = makeSession({
      scope: "CLIENT_USER",
      email: "contractor@journeyfurther.com",
    });

    expect(() => assertInternalViewer(session)).toThrow(ApiError);
  });
});
