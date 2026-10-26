import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashApiToken, verifyApiToken } from "@/lib/auth/api-token";
import { getSession } from "@/lib/auth/session";
import type { AppSession, AppUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db";

import { createApiTokenAction, revokeApiTokenAction } from "./actions";

/**
 * Boundary mocks only: the session seam, the cache and the database. The role
 * check, the strict schemas and the token minting run for real.
 */
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    apiToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

const TOKEN_NAME = "Retention cron";

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

function signedInAs(session: AppSession): void {
  vi.mocked(getSession).mockResolvedValue({ hasAccess: true, session });
}

function signedOut(): void {
  vi.mocked(getSession).mockResolvedValue({
    hasAccess: false,
    reason: "UNAUTHENTICATED",
    session: null,
  });
}

function signedInButDeactivated(): void {
  vi.mocked(getSession).mockResolvedValue({
    hasAccess: false,
    reason: "INACTIVE",
    session: makeSession({ isActive: false }),
  });
}

function formOf(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

const VALID_REVOKE = { tokenId: "token-1", confirmName: TOKEN_NAME };

function storedToken(revokedAt: Date | null = null): void {
  vi.mocked(prisma.apiToken.findUnique).mockResolvedValue({
    id: "token-1",
    name: TOKEN_NAME,
    revokedAt,
  } as never);
}

/** Every write either action can make. */
function writeCount(): number {
  return (
    vi.mocked(prisma.apiToken.create).mock.calls.length +
    vi.mocked(prisma.apiToken.updateMany).mock.calls.length
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  signedInAs(makeSession());
  vi.mocked(prisma.apiToken.create).mockResolvedValue({
    id: "token-1",
  } as never);
  vi.mocked(prisma.apiToken.updateMany).mockResolvedValue({
    count: 1,
  } as never);
  storedToken();
});

const REFUSALS = [
  ["an anonymous caller", signedOut, "You need to sign in again."],
  [
    "a deactivated account",
    signedInButDeactivated,
    "Your account is no longer active.",
  ],
  [
    "a MEMBER",
    () => signedInAs(makeSession({ role: "MEMBER" })),
    "Only an administrator can do this.",
  ],
  [
    "a deactivated ADMIN whose session still resolves",
    () => signedInAs(makeSession({ isActive: false })),
    "Your account is no longer active.",
  ],
] as const;

describe.each([
  [
    "createApiTokenAction",
    () => createApiTokenAction({ status: "idle" }, formOf({ name: "" })),
  ],
  [
    "revokeApiTokenAction",
    () => revokeApiTokenAction({ status: "idle" }, formOf(VALID_REVOKE)),
  ],
] as const)("%s — access", (_name, run) => {
  it.each(REFUSALS)(
    "refuses %s without writing or validating",
    async (_label, arrange, message) => {
      arrange();

      const result = await run();

      // No fieldErrors: the gate ran before the schema did.
      expect(result).toEqual({ status: "error", message });
      expect(writeCount()).toBe(0);
      expect(prisma.apiToken.findUnique).not.toHaveBeenCalled();
    },
  );
});

describe("createApiTokenAction", () => {
  it("stores the digest of the raw token it returns, and verifyApiToken accepts that token", async () => {
    const result = await createApiTokenAction(
      { status: "idle" },
      formOf({ name: TOKEN_NAME }),
    );

    if (result.status !== "created") {
      throw new Error(`expected created, got ${result.status}`);
    }
    expect(result.tokenName).toBe(TOKEN_NAME);
    expect(result.token.startsWith("slg_api_")).toBe(true);

    const stored = vi.mocked(prisma.apiToken.create).mock.calls[0]?.[0];
    expect(stored?.data).toEqual({
      name: TOKEN_NAME,
      tokenHash: hashApiToken(result.token),
    });
    expect(JSON.stringify(stored)).not.toContain(result.token);

    // The same digest, read back the way the retention route reads it.
    vi.mocked(prisma.apiToken.findUnique).mockResolvedValue({
      id: "token-1",
      name: TOKEN_NAME,
      tokenHash: stored?.data.tokenHash,
      revokedAt: null,
    } as never);
    await expect(verifyApiToken(result.token)).resolves.toMatchObject({
      ok: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/tokens");
  });

  it("trims the name before storing it", async () => {
    await createApiTokenAction(
      { status: "idle" },
      formOf({ name: `  ${TOKEN_NAME}  ` }),
    );

    expect(vi.mocked(prisma.apiToken.create).mock.calls[0]?.[0].data.name).toBe(
      TOKEN_NAME,
    );
  });

  it.each([
    ["an empty name", { name: "   " }],
    ["a name over 64 characters", { name: "x".repeat(65) }],
    ["a missing name", {}],
  ])("rejects %s with a field error", async (_label, fields) => {
    const result = await createApiTokenAction(
      { status: "idle" },
      formOf(fields),
    );

    expect(result.status).toBe("error");
    expect(
      result.status === "error" ? result.fieldErrors?.name : undefined,
    ).toBeDefined();
    expect(prisma.apiToken.create).not.toHaveBeenCalled();
  });

  it("accepts a name of exactly 64 characters", async () => {
    const result = await createApiTokenAction(
      { status: "idle" },
      formOf({ name: "x".repeat(64) }),
    );

    expect(result.status).toBe("created");
  });

  it("rejects fields the schema does not name, such as a caller-chosen digest", async () => {
    const result = await createApiTokenAction(
      { status: "idle" },
      formOf({ name: TOKEN_NAME, tokenHash: "b".repeat(64) }),
    );

    expect(result.status).toBe("error");
    expect(prisma.apiToken.create).not.toHaveBeenCalled();
  });

  it("ignores React's own progressive-enhancement fields", async () => {
    const result = await createApiTokenAction(
      { status: "idle" },
      formOf({ name: TOKEN_NAME, $ACTION_KEY: "k0" }),
    );

    expect(result.status).toBe("created");
  });

  it("mints a different token every time", async () => {
    const first = await createApiTokenAction(
      { status: "idle" },
      formOf({ name: TOKEN_NAME }),
    );
    const second = await createApiTokenAction(
      { status: "idle" },
      formOf({ name: TOKEN_NAME }),
    );

    expect(first.status === "created" && first.token).not.toBe(
      second.status === "created" && second.token,
    );
  });
});

describe("revokeApiTokenAction", () => {
  it("stamps revokedAt on a live token whose name was retyped", async () => {
    const result = await revokeApiTokenAction(
      { status: "idle" },
      formOf(VALID_REVOKE),
    );

    expect(result).toEqual({ status: "revoked", tokenName: TOKEN_NAME });
    const call = vi.mocked(prisma.apiToken.updateMany).mock.calls[0]?.[0];
    expect(call?.where).toEqual({ id: "token-1", revokedAt: null });
    expect(call?.data.revokedAt).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledWith("/tokens");
  });

  it("refuses a mismatched name with a field error", async () => {
    const result = await revokeApiTokenAction(
      { status: "idle" },
      formOf({ ...VALID_REVOKE, confirmName: `${TOKEN_NAME} but wrong` }),
    );

    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { confirmName: ["Type the token's name exactly."] },
    });
    expect(prisma.apiToken.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a missing confirmation before reading the token", async () => {
    const result = await revokeApiTokenAction(
      { status: "idle" },
      formOf({ tokenId: "token-1" }),
    );

    expect(result.status).toBe("error");
    expect(prisma.apiToken.findUnique).not.toHaveBeenCalled();
  });

  it("refuses fields the schema does not name", async () => {
    const result = await revokeApiTokenAction(
      { status: "idle" },
      formOf({ ...VALID_REVOKE, revokedAt: "1970-01-01" }),
    );

    expect(result.status).toBe("error");
    expect(prisma.apiToken.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an unknown token", async () => {
    vi.mocked(prisma.apiToken.findUnique).mockResolvedValue(null);

    const result = await revokeApiTokenAction(
      { status: "idle" },
      formOf(VALID_REVOKE),
    );

    expect(result).toEqual({
      status: "error",
      message: "That token no longer exists.",
    });
    expect(prisma.apiToken.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a token that is already revoked", async () => {
    storedToken(new Date("2026-01-01T00:00:00.000Z"));

    const result = await revokeApiTokenAction(
      { status: "idle" },
      formOf(VALID_REVOKE),
    );

    expect(result).toEqual({
      status: "error",
      message: "That token is already revoked.",
    });
    expect(prisma.apiToken.updateMany).not.toHaveBeenCalled();
  });

  it("never reads the stored digest", async () => {
    await revokeApiTokenAction({ status: "idle" }, formOf(VALID_REVOKE));

    const call = vi.mocked(prisma.apiToken.findUnique).mock.calls[0]?.[0];
    expect(call?.select).not.toHaveProperty("tokenHash");
  });
});
