import { describe, expect, it } from "vitest";

import { isAdminUser } from "./roles";
import type { AppSession, AppUser } from "./types";

/**
 * The predicate the admin gate is built on.
 *
 * Tested directly as well as through `assertAdminViewer`, because it is
 * exported and a future call site will use it to decide what to RENDER —
 * where a wrong answer is a button offered to someone the action will refuse.
 */
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

describe("isAdminUser", () => {
  it("accepts a live ADMIN", () => {
    expect(isAdminUser(makeSession())).toBe(true);
  });

  it("refuses a MEMBER", () => {
    expect(isAdminUser(makeSession({ role: "MEMBER" }))).toBe(false);
  });

  it("refuses a deactivated ADMIN — the role does not outlive the account", () => {
    expect(isAdminUser(makeSession({ isActive: false }))).toBe(false);
  });

  it("refuses a deactivated MEMBER", () => {
    expect(isAdminUser(makeSession({ role: "MEMBER", isActive: false }))).toBe(
      false,
    );
  });
});
