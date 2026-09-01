import type { SalientSession } from "@journey-further/salient-auth/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";

import {
  getApplicationBySlug,
  listApplications,
  listIngestKeys,
} from "./queries";

/**
 * The gate on application and key reads, proved the same way as the log reads:
 * the database is the only mock, the access check runs for real, and a refusal
 * must happen BEFORE any query is issued.
 */
vi.mock("@/lib/db", () => ({
  prisma: {
    application: { findMany: vi.fn(), findUnique: vi.fn() },
    ingestKey: { findMany: vi.fn() },
  },
}));

function makeSession(
  overrides: Partial<SalientSession["user"]> = {},
): SalientSession {
  return {
    user: {
      id: "user-1",
      email: "someone@makingstuffs.co.uk",
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

const INTERNAL_SESSION = makeSession();
const CLIENT_SESSION = makeSession({ scope: "CLIENT_ADMIN" });
const DEACTIVATED_SESSION = makeSession({ isActive: false });
const ANONYMOUS_SESSION = makeSession({
  id: "",
  email: "",
  scope: "CLIENT_USER",
  isActive: false,
});

const READS = [
  ["listApplications", (session: SalientSession) => listApplications(session)],
  [
    "getApplicationBySlug",
    (session: SalientSession) => getApplicationBySlug(session, "checkout"),
  ],
  [
    "listIngestKeys",
    (session: SalientSession) => listIngestKeys(session, "app-1"),
  ],
] as const;

function prismaCallCount(): number {
  return [
    vi.mocked(prisma.application.findMany),
    vi.mocked(prisma.application.findUnique),
    vi.mocked(prisma.ingestKey.findMany),
  ].reduce((total, mock) => total + mock.mock.calls.length, 0);
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(prisma.application.findMany).mockResolvedValue([]);
  vi.mocked(prisma.application.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.ingestKey.findMany).mockResolvedValue([]);
});

describe.each(READS)("%s", (_name, read) => {
  it("refuses an anonymous caller", async () => {
    await expect(read(ANONYMOUS_SESSION)).rejects.toBeInstanceOf(ApiError);
  });

  it("refuses a client-scoped caller with FORBIDDEN", async () => {
    await expect(read(CLIENT_SESSION)).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("refuses a deactivated user with UNAUTHORIZED", async () => {
    await expect(read(DEACTIVATED_SESSION)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("issues no query at all when it refuses", async () => {
    for (const session of [
      ANONYMOUS_SESSION,
      CLIENT_SESSION,
      DEACTIVATED_SESSION,
    ]) {
      await expect(read(session)).rejects.toBeInstanceOf(ApiError);
    }

    expect(prismaCallCount()).toBe(0);
  });

  it("queries for an internal caller, proving the gate is what refused", async () => {
    await read(INTERNAL_SESSION);

    expect(prismaCallCount()).toBeGreaterThan(0);
  });
});

describe("getApplicationBySlug", () => {
  it("rejects a malformed slug without querying, even for an internal caller", async () => {
    const result = await getApplicationBySlug(
      INTERNAL_SESSION,
      "../../etc/passwd",
    );

    expect(result).toBeNull();
    expect(prismaCallCount()).toBe(0);
  });
});
