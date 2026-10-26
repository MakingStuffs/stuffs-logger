import { PUBLIC_KEY_PREFIX, SECRET_KEY_PREFIX } from "@stuffs/logger-core";
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "@/lib/auth/session";
import type { AppSession, AppUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db";

import { createIngestKeyAction, revokeIngestKeyAction } from "./actions";

/**
 * Boundary mocks only: the session seam and the database client. Everything in
 * between — the role check, the schema, the key generation — runs for real,
 * because those are the things these tests exist to hold.
 *
 * The session seam is replaced by a FACTORY rather than spied on, so the real
 * module — and with it Better Auth, the Prisma adapter and `next/headers` —
 * never loads. A unit test of an action should not need an auth instance.
 */
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    application: { findUnique: vi.fn() },
    ingestKey: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
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

function signedInAs(session: AppSession): void {
  vi.mocked(getSession).mockResolvedValue({ hasAccess: true, session });
}

/** Nobody at all: the fail-closed arm, which carries no session. */
function signedOut(): void {
  vi.mocked(getSession).mockResolvedValue({
    hasAccess: false,
    reason: "UNAUTHENTICATED",
    session: null,
  });
}

/** Signed in, but the account has been switched off. */
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

const VALID_CREATE = {
  applicationId: "app-1",
  name: "Checkout — production",
  type: "PUBLIC",
  allowedOrigins: "https://shop.example.test",
};

beforeEach(() => {
  // Module-factory mocks keep their call history between tests; `restoreMocks`
  // only covers spies. Without this, "was never called" assertions would pass
  // or fail depending on test order.
  vi.clearAllMocks();
  signedInAs(makeSession());
  vi.mocked(prisma.application.findUnique).mockResolvedValue({
    id: "app-1",
    slug: "checkout",
  } as never);
  vi.mocked(prisma.ingestKey.create).mockResolvedValue({
    id: "key-1",
  } as never);
});

describe("createIngestKeyAction — access", () => {
  it("refuses an anonymous caller", async () => {
    signedOut();

    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf(VALID_CREATE),
    );

    expect(result).toEqual({
      status: "error",
      message: "You need to sign in again.",
    });
    expect(prisma.ingestKey.create).not.toHaveBeenCalled();
  });

  it("refuses a caller whose account has been deactivated", async () => {
    signedInButDeactivated();

    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf(VALID_CREATE),
    );

    expect(result).toEqual({
      status: "error",
      message: "Your account is no longer active.",
    });
    expect(prisma.ingestKey.create).not.toHaveBeenCalled();
  });

  it("refuses a MEMBER, who may read logs but not mint credentials", async () => {
    signedInAs(makeSession({ role: "MEMBER" }));

    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf(VALID_CREATE),
    );

    expect(result.status).toBe("error");
    expect(prisma.ingestKey.create).not.toHaveBeenCalled();
  });

  it("refuses a deactivated ADMIN", async () => {
    signedInAs(makeSession({ role: "ADMIN", isActive: false }));

    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf(VALID_CREATE),
    );

    expect(result.status).toBe("error");
    expect(prisma.ingestKey.create).not.toHaveBeenCalled();
  });

  it("never reaches validation when the caller is refused", async () => {
    signedInAs(makeSession({ role: "MEMBER" }));

    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf({ ...VALID_CREATE, name: "" }),
    );

    // A field error here would mean the schema ran before the gate did.
    expect(
      result.status === "error" ? result.fieldErrors : undefined,
    ).toBeUndefined();
  });
});

describe("createIngestKeyAction — validation", () => {
  it("rejects a missing name with a field error", async () => {
    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf({ ...VALID_CREATE, name: "" }),
    );

    expect(result).toMatchObject({ status: "error" });
    expect(
      result.status === "error" ? result.fieldErrors?.name : undefined,
    ).toBeDefined();
    expect(prisma.ingestKey.create).not.toHaveBeenCalled();
  });

  it("rejects a key type outside the vocabulary", async () => {
    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf({ ...VALID_CREATE, type: "ROOT" }),
    );

    expect(result.status).toBe("error");
    expect(prisma.ingestKey.create).not.toHaveBeenCalled();
  });

  it("refuses a browser key with no allowed origins", async () => {
    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf({ ...VALID_CREATE, allowedOrigins: "" }),
    );

    expect(
      result.status === "error"
        ? result.fieldErrors?.allowedOrigins
        : undefined,
    ).toBeDefined();
    expect(prisma.ingestKey.create).not.toHaveBeenCalled();
  });

  it("refuses an origin that carries a path, which could never match", async () => {
    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf({
        ...VALID_CREATE,
        allowedOrigins: "https://shop.example.test/checkout",
      }),
    );

    expect(
      result.status === "error"
        ? result.fieldErrors?.allowedOrigins
        : undefined,
    ).toBeDefined();
  });

  it("refuses an origin with a trailing slash", async () => {
    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf({ ...VALID_CREATE, allowedOrigins: "https://shop.example.test/" }),
    );

    expect(result.status).toBe("error");
  });

  it("refuses a non-http origin", async () => {
    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf({ ...VALID_CREATE, allowedOrigins: "javascript:alert(1)" }),
    );

    expect(result.status).toBe("error");
  });

  it("refuses origins on a server key, which is not origin-bound", async () => {
    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf({
        ...VALID_CREATE,
        type: "SECRET",
        allowedOrigins: "https://shop.example.test",
      }),
    );

    expect(result.status).toBe("error");
    expect(prisma.ingestKey.create).not.toHaveBeenCalled();
  });

  it("refuses to create a key for an application that does not exist", async () => {
    vi.mocked(prisma.application.findUnique).mockResolvedValue(null);

    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf(VALID_CREATE),
    );

    expect(result).toEqual({
      status: "error",
      message: "That application no longer exists.",
    });
    expect(prisma.ingestKey.create).not.toHaveBeenCalled();
  });
});

describe("createIngestKeyAction — success", () => {
  it("returns a browser key and stores its origin allowlist", async () => {
    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf({
        ...VALID_CREATE,
        allowedOrigins:
          "https://shop.example.test\nhttps://checkout.example.test",
      }),
    );

    expect(result).toMatchObject({ status: "created", keyType: "PUBLIC" });
    expect(result.status === "created" ? result.plaintext : "").toContain(
      PUBLIC_KEY_PREFIX,
    );

    expect(prisma.ingestKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicationId: "app-1",
          allowedOrigins: [
            "https://shop.example.test",
            "https://checkout.example.test",
          ],
        }),
      }),
    );
  });

  it("de-duplicates repeated origins", async () => {
    await createIngestKeyAction(
      { status: "idle" },
      formOf({
        ...VALID_CREATE,
        allowedOrigins: "https://shop.example.test, https://shop.example.test",
      }),
    );

    expect(prisma.ingestKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          allowedOrigins: ["https://shop.example.test"],
        }),
      }),
    );
  });

  it("stores only a digest of a server key, never its plaintext", async () => {
    const result = await createIngestKeyAction(
      { status: "idle" },
      formOf({ ...VALID_CREATE, type: "SECRET", allowedOrigins: "" }),
    );

    expect(result).toMatchObject({ status: "created", keyType: "SECRET" });
    const plaintext = result.status === "created" ? result.plaintext : "";
    expect(plaintext).toContain(SECRET_KEY_PREFIX);

    const persisted = vi.mocked(prisma.ingestKey.create).mock.calls[0]?.[0] as {
      data: { secretHash: string | null; publicKey: string | null };
    };
    expect(persisted.data.publicKey).toBeNull();
    expect(persisted.data.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(persisted.data)).not.toContain(plaintext);
  });

  it("revalidates the application page it just changed", async () => {
    await createIngestKeyAction({ status: "idle" }, formOf(VALID_CREATE));

    expect(revalidatePath).toHaveBeenCalledWith("/apps/checkout");
  });
});

describe("revokeIngestKeyAction", () => {
  const LIVE_KEY = {
    id: "key-1",
    name: "Checkout — production",
    revokedAt: null,
    application: { slug: "checkout" },
  };

  beforeEach(() => {
    vi.mocked(prisma.ingestKey.findUnique).mockResolvedValue(LIVE_KEY as never);
    vi.mocked(prisma.ingestKey.update).mockResolvedValue({
      id: "key-1",
    } as never);
  });

  it("refuses a MEMBER", async () => {
    signedInAs(makeSession({ role: "MEMBER" }));

    const result = await revokeIngestKeyAction(
      { status: "idle" },
      formOf({ keyId: "key-1", confirmName: LIVE_KEY.name }),
    );

    expect(result.status).toBe("error");
    expect(prisma.ingestKey.update).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller", async () => {
    signedOut();

    const result = await revokeIngestKeyAction(
      { status: "idle" },
      formOf({ keyId: "key-1", confirmName: LIVE_KEY.name }),
    );

    expect(result.status).toBe("error");
    expect(prisma.ingestKey.update).not.toHaveBeenCalled();
  });

  it("refuses a deactivated caller", async () => {
    signedInButDeactivated();

    const result = await revokeIngestKeyAction(
      { status: "idle" },
      formOf({ keyId: "key-1", confirmName: LIVE_KEY.name }),
    );

    expect(result.status).toBe("error");
    expect(prisma.ingestKey.update).not.toHaveBeenCalled();
  });

  it("refuses a submission with no typed confirmation", async () => {
    const result = await revokeIngestKeyAction(
      { status: "idle" },
      formOf({ keyId: "key-1", confirmName: "" }),
    );

    expect(result.status).toBe("error");
    expect(prisma.ingestKey.update).not.toHaveBeenCalled();
  });

  it("refuses when the typed name does not match the key", async () => {
    const result = await revokeIngestKeyAction(
      { status: "idle" },
      formOf({ keyId: "key-1", confirmName: "something else" }),
    );

    expect(result).toMatchObject({
      status: "error",
      message: "The name you typed does not match this key.",
    });
    expect(prisma.ingestKey.update).not.toHaveBeenCalled();
  });

  it("reports a key that no longer exists", async () => {
    vi.mocked(prisma.ingestKey.findUnique).mockResolvedValue(null);

    const result = await revokeIngestKeyAction(
      { status: "idle" },
      formOf({ keyId: "key-1", confirmName: LIVE_KEY.name }),
    );

    expect(result).toEqual({
      status: "error",
      message: "That key no longer exists.",
    });
  });

  it("reports a key that is already revoked", async () => {
    vi.mocked(prisma.ingestKey.findUnique).mockResolvedValue({
      ...LIVE_KEY,
      revokedAt: new Date(),
    } as never);

    const result = await revokeIngestKeyAction(
      { status: "idle" },
      formOf({ keyId: "key-1", confirmName: LIVE_KEY.name }),
    );

    expect(result).toEqual({
      status: "error",
      message: "That key is already revoked.",
    });
    expect(prisma.ingestKey.update).not.toHaveBeenCalled();
  });

  it("revokes the key when the confirmation matches", async () => {
    const result = await revokeIngestKeyAction(
      { status: "idle" },
      formOf({ keyId: "key-1", confirmName: LIVE_KEY.name }),
    );

    expect(result).toEqual({ status: "revoked", keyName: LIVE_KEY.name });
    expect(prisma.ingestKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "key-1" },
        data: { revokedAt: expect.any(Date) },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/apps/checkout");
  });
});
