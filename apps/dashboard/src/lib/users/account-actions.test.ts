import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/session";
import {
  resetSignInThrottle,
  SIGN_IN_MAX_ATTEMPTS,
} from "@/lib/auth/sign-in-throttle";
import { prisma } from "@/lib/db";

import type { AccountActionResult } from "./action-result";
import {
  changeOwnPasswordAction,
  revokeOtherSessionsAction,
} from "./account-actions";
import { formOf, makeSession } from "./test-support";

/**
 * Boundary mocks: the session seam, Better Auth's API, the database and the
 * request headers. The THROTTLE IS REAL — counting the attempts is the
 * property under test, so mocking it would prove nothing.
 */
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/auth", () => ({
  auth: { api: { changePassword: vi.fn(), revokeOtherSessions: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ prisma: { account: { findFirst: vi.fn() } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(
    async () => new Headers({ "x-forwarded-for": "198.51.100.7" }),
  ),
}));

const IDLE: AccountActionResult = { status: "idle" };

const VALID_CHANGE = {
  currentPassword: "the-current-password",
  newPassword: "a-brand-new-password",
  confirmPassword: "a-brand-new-password",
};

function hasCredential(present: boolean): void {
  vi.mocked(prisma.account.findFirst).mockResolvedValue(
    (present ? { id: "account-1" } : null) as never,
  );
}

function wrongCurrentPassword(): void {
  vi.mocked(auth.api.changePassword).mockRejectedValue(
    new Error("INVALID_PASSWORD"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSignInThrottle();
  vi.mocked(getSession).mockResolvedValue({
    hasAccess: true,
    session: makeSession({ id: "me", email: "me@example.test" }),
  });
  hasCredential(true);
  vi.mocked(auth.api.changePassword).mockResolvedValue({} as never);
  vi.mocked(auth.api.revokeOtherSessions).mockResolvedValue({} as never);
});

describe("changeOwnPasswordAction", () => {
  it("refuses an anonymous caller without trying a password", async () => {
    vi.mocked(getSession).mockResolvedValue({
      hasAccess: false,
      reason: "UNAUTHENTICATED",
      session: null,
    });

    await expect(
      changeOwnPasswordAction(IDLE, formOf(VALID_CHANGE)),
    ).resolves.toEqual({
      status: "error",
      message: "You need to sign in again.",
    });
    expect(auth.api.changePassword).not.toHaveBeenCalled();
  });

  it("refuses a deactivated caller without trying a password", async () => {
    vi.mocked(getSession).mockResolvedValue({
      hasAccess: false,
      reason: "INACTIVE",
      session: makeSession({ isActive: false }),
    });

    await expect(
      changeOwnPasswordAction(IDLE, formOf(VALID_CHANGE)),
    ).resolves.toEqual({
      status: "error",
      message: "Your account is no longer active.",
    });
    expect(auth.api.changePassword).not.toHaveBeenCalled();
  });

  it("changes the password and revokes every other session", async () => {
    const result = await changeOwnPasswordAction(IDLE, formOf(VALID_CHANGE));

    expect(result).toMatchObject({ status: "success" });
    expect(auth.api.changePassword).toHaveBeenCalledWith({
      body: {
        currentPassword: VALID_CHANGE.currentPassword,
        newPassword: VALID_CHANGE.newPassword,
        revokeOtherSessions: false,
      },
      headers: expect.any(Headers),
    });
    expect(auth.api.revokeOtherSessions).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    });
  });

  it("keeps the current session: never asks the library to rotate it", async () => {
    await changeOwnPasswordAction(IDLE, formOf(VALID_CHANGE));

    // Rotating sets a cookie, which re-renders the page against the old,
    // now-deleted token and bounces the user through sign-in.
    const call = vi.mocked(auth.api.changePassword).mock.calls[0]?.[0];
    expect(call?.body.revokeOtherSessions).toBe(false);
  });

  it("says so when the password changed but other sessions survived", async () => {
    vi.mocked(auth.api.revokeOtherSessions).mockRejectedValueOnce(
      new Error("x"),
    );

    const result = await changeOwnPasswordAction(IDLE, formOf(VALID_CHANGE));

    expect(result).toMatchObject({ status: "error" });
    if (result.status !== "error") return;
    expect(result.message).toMatch(/password was changed/i);
  });

  it("refuses a new password under 12 characters", async () => {
    const result = await changeOwnPasswordAction(
      IDLE,
      formOf({
        ...VALID_CHANGE,
        newPassword: "short",
        confirmPassword: "short",
      }),
    );

    if (result.status !== "error") throw new Error("expected error");
    expect(result.fieldErrors?.newPassword).toEqual([
      "Use at least 12 characters.",
    ]);
    expect(auth.api.changePassword).not.toHaveBeenCalled();
  });

  it("refuses a new password over 128 characters", async () => {
    const long = "x".repeat(129);

    const result = await changeOwnPasswordAction(
      IDLE,
      formOf({ ...VALID_CHANGE, newPassword: long, confirmPassword: long }),
    );

    expect(result).toMatchObject({ status: "error" });
    expect(auth.api.changePassword).not.toHaveBeenCalled();
  });

  it("refuses a confirmation that does not match", async () => {
    const result = await changeOwnPasswordAction(
      IDLE,
      formOf({ ...VALID_CHANGE, confirmPassword: "something-else-entirely" }),
    );

    if (result.status !== "error") throw new Error("expected error");
    expect(result.fieldErrors?.confirmPassword).toEqual([
      "The two new passwords do not match.",
    ]);
    expect(auth.api.changePassword).not.toHaveBeenCalled();
  });

  it("tells a Google-only user there is no password to change", async () => {
    hasCredential(false);

    const result = await changeOwnPasswordAction(IDLE, formOf(VALID_CHANGE));

    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("Google"),
    });
    expect(auth.api.changePassword).not.toHaveBeenCalled();
  });

  it("answers a wrong current password generically", async () => {
    wrongCurrentPassword();

    await expect(
      changeOwnPasswordAction(IDLE, formOf(VALID_CHANGE)),
    ).resolves.toEqual({
      status: "error",
      message:
        "Your password was not changed. Check your current password and try again.",
    });
  });

  it("throttles repeated wrong guesses before they reach the hash", async () => {
    wrongCurrentPassword();

    for (let attempt = 0; attempt < SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
      await changeOwnPasswordAction(IDLE, formOf(VALID_CHANGE));
    }
    vi.mocked(auth.api.changePassword).mockClear();

    const result = await changeOwnPasswordAction(IDLE, formOf(VALID_CHANGE));

    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("Too many attempts"),
    });
    expect(auth.api.changePassword).not.toHaveBeenCalled();
  });

  it("never echoes a password in its result", async () => {
    wrongCurrentPassword();

    const result = await changeOwnPasswordAction(IDLE, formOf(VALID_CHANGE));

    expect(JSON.stringify(result)).not.toContain(VALID_CHANGE.currentPassword);
    expect(JSON.stringify(result)).not.toContain(VALID_CHANGE.newPassword);
  });
});

describe("revokeOtherSessionsAction", () => {
  it("refuses an anonymous caller", async () => {
    vi.mocked(getSession).mockResolvedValue({
      hasAccess: false,
      reason: "UNAUTHENTICATED",
      session: null,
    });

    await expect(
      revokeOtherSessionsAction(IDLE, formOf({})),
    ).resolves.toMatchObject({ status: "error" });
    expect(auth.api.revokeOtherSessions).not.toHaveBeenCalled();
  });

  it("revokes the caller's other sessions", async () => {
    await expect(
      revokeOtherSessionsAction(IDLE, formOf({})),
    ).resolves.toMatchObject({ status: "success" });
    expect(auth.api.revokeOtherSessions).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    });
  });

  it("reports a failure without throwing", async () => {
    vi.mocked(auth.api.revokeOtherSessions).mockRejectedValue(new Error("x"));

    await expect(
      revokeOtherSessionsAction(IDLE, formOf({})),
    ).resolves.toMatchObject({ status: "error" });
  });
});
