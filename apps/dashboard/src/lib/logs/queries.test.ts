import type { SalientSession } from "@journey-further/salient-auth/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";

import {
  getApplicationActivity,
  getLogEvent,
  listEnvironments,
  listLogEvents,
} from "./queries";

/**
 * The gate, proved from the outside.
 *
 * Only the database is mocked — the boundary. The access check itself runs for
 * real, so these tests fail if the gate is weakened, and they assert that NO
 * QUERY IS ISSUED on refusal: a check that runs after the read has already
 * leaked the rows it was meant to protect. Deleting the gate line from any
 * function below turns its three denial tests red.
 */
vi.mock("@/lib/db", () => ({
  prisma: {
    logEvent: { findMany: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn() },
    application: { findMany: vi.fn() },
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

const CLIENT_SESSION = makeSession({ scope: "CLIENT_ADMIN" });
const DEACTIVATED_SESSION = makeSession({ isActive: false });
const INTERNAL_SESSION = makeSession();

const FILTERS = { limit: 50 } as const;
const WINDOW = {
  from: new Date("2026-09-01T00:00:00.000Z"),
  to: new Date("2026-09-02T00:00:00.000Z"),
};

/**
 * The anonymous caller.
 *
 * There is no "no session" arm in these signatures — a call site with no
 * session cannot compile — so the closest reachable state is a session object
 * with no identity behind it, which must be refused like any other.
 */
const ANONYMOUS_SESSION = makeSession({
  id: "",
  email: "",
  scope: "CLIENT_USER",
  isActive: false,
});

/** Every query function under test, with a call that would hit the database. */
const READS = [
  [
    "listLogEvents",
    (session: SalientSession) => listLogEvents(session, FILTERS),
  ],
  ["getLogEvent", (session: SalientSession) => getLogEvent(session, "event-1")],
  [
    "getApplicationActivity",
    (session: SalientSession) => getApplicationActivity(session, WINDOW),
  ],
  [
    "listEnvironments",
    (session: SalientSession) => listEnvironments(session, "app-1"),
  ],
] as const;

function prismaCallCount(): number {
  return [
    vi.mocked(prisma.logEvent.findMany),
    vi.mocked(prisma.logEvent.findUnique),
    vi.mocked(prisma.logEvent.groupBy),
    vi.mocked(prisma.application.findMany),
  ].reduce((total, mock) => total + mock.mock.calls.length, 0);
}

beforeEach(() => {
  // The doubles come from a module factory, so `restoreMocks` does not reset
  // their call records: the counts below would otherwise carry between tests.
  vi.clearAllMocks();

  vi.mocked(prisma.logEvent.findMany).mockResolvedValue([]);
  vi.mocked(prisma.logEvent.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.logEvent.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.application.findMany).mockResolvedValue([]);
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
