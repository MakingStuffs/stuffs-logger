import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

import {
  getOwnAccount,
  listUsers,
  OWN_ACCOUNT_SELECT,
  USER_LIST_SELECT,
} from "./queries";
import { deepKeys, makeSession, SECRET_COLUMNS } from "./test-support";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    account: { findMany: vi.fn() },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findMany).mockResolvedValue([
    {
      id: "user-1",
      name: "Ada",
      email: "ada@example.test",
      role: "MEMBER",
      isActive: true,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      accounts: [{ providerId: "google" }],
      sessions: [{ updatedAt: new Date("2026-03-01T12:00:00.000Z") }],
    },
  ] as never);
  vi.mocked(prisma.account.findMany).mockResolvedValue([
    { providerId: "credential" },
  ] as never);
});

describe("listUsers", () => {
  it("refuses a member without querying", async () => {
    await expect(listUsers(makeSession({ role: "MEMBER" }))).rejects.toThrow(
      "Only an administrator can do this.",
    );
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("refuses a deactivated admin without querying", async () => {
    await expect(listUsers(makeSession({ isActive: false }))).rejects.toThrow(
      "Your account is no longer active.",
    );
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("projects rows into summaries with sign-in methods and last seen", async () => {
    await expect(listUsers(makeSession())).resolves.toEqual([
      {
        id: "user-1",
        name: "Ada",
        email: "ada@example.test",
        role: "MEMBER",
        isActive: true,
        signInMethods: { password: false, google: true, other: [] },
        createdAt: "2026-02-01T00:00:00.000Z",
        lastSeenAt: "2026-03-01T12:00:00.000Z",
      },
    ]);
  });

  it("reports never-seen for a user with no sessions", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: "user-2",
        name: "Bo",
        email: "bo@example.test",
        role: "MEMBER",
        isActive: false,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        accounts: [],
        sessions: [],
      },
    ] as never);

    const [row] = await listUsers(makeSession());

    expect(row?.lastSeenAt).toBeNull();
  });

  it("queries with the fixed selector", async () => {
    await listUsers(makeSession());

    expect(vi.mocked(prisma.user.findMany).mock.calls[0]?.[0]?.select).toBe(
      USER_LIST_SELECT,
    );
  });

  it.each(SECRET_COLUMNS)("never selects %s at any depth", (column) => {
    expect(deepKeys(USER_LIST_SELECT)).not.toContain(column);
  });
});

describe("getOwnAccount", () => {
  it("refuses a deactivated caller without querying", async () => {
    await expect(
      getOwnAccount(makeSession({ isActive: false })),
    ).rejects.toThrow("Your account is no longer active.");
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });

  it("reads only the caller's own accounts", async () => {
    await getOwnAccount(makeSession({ id: "me" }));

    expect(vi.mocked(prisma.account.findMany).mock.calls[0]?.[0]).toEqual({
      where: { userId: "me" },
      select: OWN_ACCOUNT_SELECT,
    });
  });

  it("describes the account from the session", async () => {
    await expect(
      getOwnAccount(makeSession({ role: "MEMBER" })),
    ).resolves.toEqual({
      name: "An Admin",
      email: "admin@makingstuffs.test",
      role: "MEMBER",
      signInMethods: { password: true, google: false, other: [] },
    });
  });

  it.each(SECRET_COLUMNS)("never selects %s", (column) => {
    expect(deepKeys(OWN_ACCOUNT_SELECT)).not.toContain(column);
  });
});
