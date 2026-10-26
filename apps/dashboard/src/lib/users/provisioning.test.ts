import { createLocalAccountIssuer } from "better-auth/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

import {
  createUserWithTemporaryPassword,
  endAllSessions,
  issueTemporaryPassword,
} from "./provisioning";

/**
 * Boundary mocks only: Better Auth's context (the hasher and the internal
 * adapter) and the Prisma client. The orchestration — order of writes, the
 * compensating delete, the credential row shape — runs for real.
 */
const { ctx } = vi.hoisted(() => ({
  ctx: {
    password: { hash: vi.fn() },
    internalAdapter: {
      createUser: vi.fn(),
      linkAccount: vi.fn(),
      findCredentialAccount: vi.fn(),
      updatePassword: vi.fn(),
      deleteUserSessions: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: { $context: Promise.resolve(ctx) },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

const HASH = "scrypt:hash-of-the-temporary-password";

beforeEach(() => {
  vi.clearAllMocks();
  ctx.password.hash.mockResolvedValue(HASH);
  ctx.internalAdapter.createUser.mockResolvedValue({ id: "new-user" });
  ctx.internalAdapter.linkAccount.mockResolvedValue({ id: "account-1" });
  ctx.internalAdapter.findCredentialAccount.mockResolvedValue(null);
  vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.user.update).mockResolvedValue({ id: "new-user" } as never);
});

const INPUT = {
  name: " Ada ",
  email: " Ada@Example.TEST ",
  role: "ADMIN",
} as const;

describe("createUserWithTemporaryPassword", () => {
  it("refuses an address already held, ignoring case, without writing", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "x" } as never);

    await expect(createUserWithTemporaryPassword(INPUT)).resolves.toEqual({
      status: "email_taken",
    });
    expect(vi.mocked(prisma.user.findFirst).mock.calls[0]?.[0]).toEqual({
      where: { email: { equals: "ada@example.test", mode: "insensitive" } },
      select: { id: true },
    });
    expect(ctx.internalAdapter.createUser).not.toHaveBeenCalled();
  });

  it("creates the user, sets the role, and links a credential", async () => {
    const outcome = await createUserWithTemporaryPassword(INPUT);

    expect(outcome).toMatchObject({
      status: "created",
      userId: "new-user",
      email: "ada@example.test",
    });
    expect(ctx.internalAdapter.createUser).toHaveBeenCalledWith(
      { email: "ada@example.test", name: "Ada", emailVerified: true },
      { method: "email-password" },
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "new-user" },
      data: { role: "ADMIN", isActive: true },
      select: { id: true },
    });
    expect(ctx.internalAdapter.linkAccount).toHaveBeenCalledWith({
      userId: "new-user",
      accountId: "new-user",
      providerId: "credential",
      issuer: createLocalAccountIssuer("credential"),
      password: HASH,
    });
  });

  it("hashes the password it returns, and stores only the hash", async () => {
    const outcome = await createUserWithTemporaryPassword(INPUT);
    if (outcome.status !== "created") throw new Error("expected created");

    expect(ctx.password.hash).toHaveBeenCalledWith(outcome.temporaryPassword);
    expect(
      JSON.stringify(ctx.internalAdapter.linkAccount.mock.calls),
    ).not.toContain(outcome.temporaryPassword);
  });

  it("treats a unique violation on create as a lost race for the address", async () => {
    ctx.internalAdapter.createUser.mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );

    await expect(createUserWithTemporaryPassword(INPUT)).resolves.toEqual({
      status: "email_taken",
    });
  });

  it("deletes the half-made user when linking the credential fails", async () => {
    ctx.internalAdapter.linkAccount.mockRejectedValue(new Error("db down"));

    await expect(createUserWithTemporaryPassword(INPUT)).rejects.toThrow(
      "db down",
    );
    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: "new-user" },
      select: { id: true },
    });
  });
});

describe("issueTemporaryPassword", () => {
  it("adds a credential for a user who has none", async () => {
    const issued = await issueTemporaryPassword("google-user");

    expect(issued.mode).toBe("added");
    expect(ctx.internalAdapter.linkAccount).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "google-user", password: HASH }),
    );
    expect(ctx.internalAdapter.updatePassword).not.toHaveBeenCalled();
  });

  it("replaces an existing password", async () => {
    ctx.internalAdapter.findCredentialAccount.mockResolvedValue({ id: "a" });

    const issued = await issueTemporaryPassword("user-1");

    expect(issued.mode).toBe("reset");
    expect(ctx.internalAdapter.updatePassword).toHaveBeenCalledWith(
      "user-1",
      HASH,
    );
    expect(ctx.internalAdapter.linkAccount).not.toHaveBeenCalled();
  });
});

describe("endAllSessions", () => {
  it("deletes the user's sessions through the auth adapter", async () => {
    await endAllSessions("user-1");

    expect(ctx.internalAdapter.deleteUserSessions).toHaveBeenCalledWith(
      "user-1",
    );
  });
});
