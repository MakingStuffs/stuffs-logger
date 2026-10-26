import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "@/lib/auth/session";
import type { AppSession } from "@/lib/auth/types";

import type { UserActionResult } from "./action-result";
import {
  changeUserRoleAction,
  createUserAction,
  deactivateUserAction,
  reactivateUserAction,
  resetUserPasswordAction,
} from "./actions";
import { formOf, makeSession } from "./test-support";

/**
 * Boundary mocks only: the session seam, Better Auth's context, the Prisma
 * client and Next's cache. The caller gate, the schemas, the guards, the
 * transaction body and the provisioning orchestration all run for real —
 * they are what these tests exist to hold.
 *
 * Every refusal asserts that NOTHING WAS WRITTEN: a refused action that still
 * touched a row would be a refusal in name only.
 */
const { db, ctx } = vi.hoisted(() => {
  const db = {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  const ctx = {
    password: { hash: vi.fn() },
    internalAdapter: {
      createUser: vi.fn(),
      linkAccount: vi.fn(),
      findCredentialAccount: vi.fn(),
      updatePassword: vi.fn(),
      deleteUserSessions: vi.fn(),
    },
  };
  return { db, ctx };
});

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/auth", () => ({
  auth: { $context: Promise.resolve(ctx) },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const IDLE: UserActionResult = { status: "idle" };
const ADMIN_ID = "admin-1";

interface TargetRow {
  id: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  isActive: boolean;
}

function makeTarget(overrides: Partial<TargetRow> = {}): TargetRow {
  return {
    id: "user-2",
    email: "bo@example.test",
    role: "MEMBER",
    isActive: true,
    ...overrides,
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

function targetIs(row: TargetRow | null): void {
  db.user.findUnique.mockResolvedValue(row);
}

function activeAdmins(count: number): void {
  db.user.count.mockResolvedValue(count);
}

/** Asserts no write of any kind reached the database or the auth adapter. */
function expectNoWrites(): void {
  expect(db.user.update).not.toHaveBeenCalled();
  expect(db.user.delete).not.toHaveBeenCalled();
  expect(ctx.internalAdapter.createUser).not.toHaveBeenCalled();
  expect(ctx.internalAdapter.linkAccount).not.toHaveBeenCalled();
  expect(ctx.internalAdapter.updatePassword).not.toHaveBeenCalled();
  expect(ctx.internalAdapter.deleteUserSessions).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  signedInAs(makeSession({ id: ADMIN_ID }));
  db.$transaction.mockImplementation(
    async (work: (tx: typeof db) => Promise<unknown>) => work(db),
  );
  db.user.findFirst.mockResolvedValue(null);
  db.user.update.mockResolvedValue({ id: "user-2" });
  targetIs(makeTarget());
  activeAdmins(2);
  ctx.password.hash.mockResolvedValue("scrypt:hash");
  ctx.internalAdapter.createUser.mockResolvedValue({ id: "new-user" });
  ctx.internalAdapter.findCredentialAccount.mockResolvedValue({ id: "acc" });
});

/**
 * Every admin action, with a form that would otherwise succeed, so the access
 * refusals can be proved once for all of them.
 */
const ADMIN_ACTIONS = [
  [
    "createUserAction",
    createUserAction,
    { name: "Ada", email: "ada@example.test", role: "MEMBER" },
  ],
  [
    "changeUserRoleAction",
    changeUserRoleAction,
    { userId: "user-2", role: "ADMIN" },
  ],
  [
    "deactivateUserAction",
    deactivateUserAction,
    { userId: "user-2", confirmEmail: "bo@example.test" },
  ],
  ["reactivateUserAction", reactivateUserAction, { userId: "user-2" }],
  [
    "resetUserPasswordAction",
    resetUserPasswordAction,
    { userId: "user-2", confirmEmail: "bo@example.test" },
  ],
] as const;

describe.each(ADMIN_ACTIONS)("%s — access", (_name, action, fields) => {
  it("refuses an anonymous caller without writing", async () => {
    signedOut();

    await expect(action(IDLE, formOf(fields))).resolves.toEqual({
      status: "error",
      message: "You need to sign in again.",
    });
    expectNoWrites();
  });

  it("refuses a deactivated caller without writing", async () => {
    signedInButDeactivated();

    await expect(action(IDLE, formOf(fields))).resolves.toEqual({
      status: "error",
      message: "Your account is no longer active.",
    });
    expectNoWrites();
  });

  it("refuses a MEMBER without writing", async () => {
    signedInAs(makeSession({ role: "MEMBER" }));

    await expect(action(IDLE, formOf(fields))).resolves.toEqual({
      status: "error",
      message: "Only an administrator can do this.",
    });
    expectNoWrites();
  });
});

describe("createUserAction", () => {
  it("creates the user and returns the temporary password once", async () => {
    const result = await createUserAction(
      IDLE,
      formOf({ name: "Ada", email: "Ada@Example.test", role: "ADMIN" }),
    );

    expect(result).toMatchObject({
      status: "created",
      name: "Ada",
      email: "ada@example.test",
    });
    if (result.status !== "created") throw new Error("expected created");
    expect(result.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: "ADMIN", isActive: true } }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/users");
  });

  it("reports a duplicate address, ignoring case, as a field error", async () => {
    db.user.findFirst.mockResolvedValue({ id: "existing" });

    const result = await createUserAction(
      IDLE,
      formOf({ name: "Ada", email: "ADA@example.test", role: "MEMBER" }),
    );

    expect(result).toMatchObject({
      status: "error",
      fieldErrors: {
        email: ["A user with this email address already exists."],
      },
    });
    expectNoWrites();
  });

  it("refuses a role outside the vocabulary", async () => {
    const result = await createUserAction(
      IDLE,
      formOf({ name: "Ada", email: "ada@example.test", role: "OWNER" }),
    );

    expect(result).toMatchObject({ status: "error" });
    if (result.status !== "error") throw new Error("expected error");
    expect(result.fieldErrors?.role).toBeDefined();
    expectNoWrites();
  });

  it("refuses an address that is not one", async () => {
    const result = await createUserAction(
      IDLE,
      formOf({ name: "Ada", email: "not-an-address", role: "MEMBER" }),
    );

    if (result.status !== "error") throw new Error("expected error");
    expect(result.fieldErrors?.email).toEqual(["Enter a valid email address."]);
    expectNoWrites();
  });
});

describe("changeUserRoleAction", () => {
  it("changes another user's role", async () => {
    const result = await changeUserRoleAction(
      IDLE,
      formOf({ userId: "user-2", role: "ADMIN" }),
    );

    expect(result).toEqual({
      status: "updated",
      message: "bo@example.test is now an administrator.",
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: { role: "ADMIN" },
      select: { id: true },
    });
  });

  it("evaluates the guard inside a serializable transaction", async () => {
    await changeUserRoleAction(
      IDLE,
      formOf({ userId: "user-2", role: "ADMIN" }),
    );

    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("refuses an admin demoting themself", async () => {
    targetIs(makeTarget({ id: ADMIN_ID, role: "ADMIN" }));

    const result = await changeUserRoleAction(
      IDLE,
      formOf({ userId: ADMIN_ID, role: "MEMBER" }),
    );

    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("your own account"),
    });
    expectNoWrites();
  });

  it("refuses demoting the last active admin", async () => {
    targetIs(makeTarget({ role: "ADMIN" }));
    activeAdmins(1);

    const result = await changeUserRoleAction(
      IDLE,
      formOf({ userId: "user-2", role: "MEMBER" }),
    );

    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("last active administrator"),
    });
    expectNoWrites();
  });

  it("reports a concurrent change as a conflict, not a success", async () => {
    db.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization"), { code: "P2034" }),
    );

    const result = await changeUserRoleAction(
      IDLE,
      formOf({ userId: "user-2", role: "MEMBER" }),
    );

    expect(result).toMatchObject({ status: "error" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports an unknown user", async () => {
    targetIs(null);

    await expect(
      changeUserRoleAction(IDLE, formOf({ userId: "nobody", role: "ADMIN" })),
    ).resolves.toEqual({
      status: "error",
      message: "That user no longer exists.",
    });
    expectNoWrites();
  });
});

describe("deactivateUserAction", () => {
  it("deactivates the user and ends their sessions", async () => {
    const result = await deactivateUserAction(
      IDLE,
      formOf({ userId: "user-2", confirmEmail: "BO@example.test " }),
    );

    expect(result).toMatchObject({ status: "updated" });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: { isActive: false },
      select: { id: true },
    });
    expect(ctx.internalAdapter.deleteUserSessions).toHaveBeenCalledWith(
      "user-2",
    );
  });

  it("refuses a confirmation that does not match", async () => {
    const result = await deactivateUserAction(
      IDLE,
      formOf({ userId: "user-2", confirmEmail: "someone@example.test" }),
    );

    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { confirmEmail: ["Type the user's email address exactly."] },
    });
    expectNoWrites();
  });

  it("refuses a missing confirmation", async () => {
    const result = await deactivateUserAction(
      IDLE,
      formOf({ userId: "user-2" }),
    );

    expect(result).toMatchObject({ status: "error" });
    expectNoWrites();
  });

  it("refuses an admin deactivating themself", async () => {
    targetIs(
      makeTarget({
        id: ADMIN_ID,
        email: "admin@makingstuffs.test",
        role: "ADMIN",
      }),
    );

    const result = await deactivateUserAction(
      IDLE,
      formOf({ userId: ADMIN_ID, confirmEmail: "admin@makingstuffs.test" }),
    );

    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("your own account"),
    });
    expectNoWrites();
  });

  it("refuses deactivating the last active admin", async () => {
    targetIs(makeTarget({ role: "ADMIN" }));
    activeAdmins(1);

    const result = await deactivateUserAction(
      IDLE,
      formOf({ userId: "user-2", confirmEmail: "bo@example.test" }),
    );

    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("last active administrator"),
    });
    expectNoWrites();
  });
});

describe("reactivateUserAction", () => {
  it("reactivates a deactivated user", async () => {
    targetIs(makeTarget({ isActive: false }));

    const result = await reactivateUserAction(
      IDLE,
      formOf({ userId: "user-2" }),
    );

    expect(result).toMatchObject({ status: "updated" });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: { isActive: true },
      select: { id: true },
    });
  });

  it("writes nothing for a user who is already active", async () => {
    await reactivateUserAction(IDLE, formOf({ userId: "user-2" }));

    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe("resetUserPasswordAction", () => {
  it("issues a temporary password and ends the user's sessions", async () => {
    const result = await resetUserPasswordAction(
      IDLE,
      formOf({ userId: "user-2", confirmEmail: "bo@example.test" }),
    );

    expect(result).toMatchObject({
      status: "password_issued",
      email: "bo@example.test",
      mode: "reset",
    });
    expect(ctx.internalAdapter.updatePassword).toHaveBeenCalledWith(
      "user-2",
      "scrypt:hash",
    );
    expect(ctx.internalAdapter.deleteUserSessions).toHaveBeenCalledWith(
      "user-2",
    );
  });

  it("adds a password for a Google-only user", async () => {
    ctx.internalAdapter.findCredentialAccount.mockResolvedValue(null);

    const result = await resetUserPasswordAction(
      IDLE,
      formOf({ userId: "user-2", confirmEmail: "bo@example.test" }),
    );

    expect(result).toMatchObject({ status: "password_issued", mode: "added" });
    expect(ctx.internalAdapter.linkAccount).toHaveBeenCalled();
  });

  it("refuses a confirmation that does not match", async () => {
    const result = await resetUserPasswordAction(
      IDLE,
      formOf({ userId: "user-2", confirmEmail: "nope@example.test" }),
    );

    expect(result).toMatchObject({ status: "error" });
    expect(ctx.password.hash).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("refuses an admin resetting themself", async () => {
    targetIs(makeTarget({ id: ADMIN_ID, email: "admin@makingstuffs.test" }));

    const result = await resetUserPasswordAction(
      IDLE,
      formOf({ userId: ADMIN_ID, confirmEmail: "admin@makingstuffs.test" }),
    );

    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("your own account"),
    });
    expectNoWrites();
  });
});
