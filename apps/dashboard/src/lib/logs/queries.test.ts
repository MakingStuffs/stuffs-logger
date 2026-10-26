import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type { AppSession, AppUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db";

import { encodeLogCursor } from "./filters";
import {
  getApplicationActivity,
  getLogEvent,
  listEnvironments,
  listLogEvents,
} from "./queries";

/**
 * The gate, proved from the outside — and the query shapes behind it.
 *
 * Only the database is mocked — the boundary. The access check itself runs for
 * real, so these tests fail if the gate is weakened, and they assert that NO
 * QUERY IS ISSUED on refusal: a check that runs after the read has already
 * leaked the rows it was meant to protect. Deleting the gate line from any
 * function below turns its denial tests red.
 *
 * The shape tests pin the parts of each query that were measured against a
 * 5M-row table: the keyset bound, the slug-to-id resolution, the one-statement
 * activity aggregate, and the loose index scan behind the environment list.
 * They assert on bound parameters and a stable SQL fragment, never on the
 * whole statement text.
 */
vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    logEvent: { findMany: vi.fn(), findUnique: vi.fn() },
    application: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

function makeSession(overrides: Partial<AppUser> = {}): AppSession {
  return {
    user: {
      id: "user-1",
      email: "someone@makingstuffs.co.uk",
      name: "Someone",
      role: "MEMBER",
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

const MEMBER_SESSION = makeSession();
const ADMIN_SESSION = makeSession({ role: "ADMIN" });
const DEACTIVATED_SESSION = makeSession({ isActive: false });
const DEACTIVATED_ADMIN_SESSION = makeSession({
  role: "ADMIN",
  isActive: false,
});

/**
 * The anonymous caller.
 *
 * There is no "no session" arm in these signatures — a call site with no
 * session cannot compile — so the closest reachable state is a session object
 * with no identity behind it, which must be refused like any other.
 */
const ANONYMOUS_SESSION = makeSession({ id: "", email: "", isActive: false });

const FILTERS = { limit: 50 } as const;
const WINDOW = {
  from: new Date("2026-09-01T00:00:00.000Z"),
  to: new Date("2026-09-02T00:00:00.000Z"),
};

/** A stream row as `LIST_SELECT` returns it. */
function makeRow(overrides: { id: string; timestamp: Date }) {
  return {
    id: overrides.id,
    applicationId: "app-1",
    timestamp: overrides.timestamp,
    receivedAt: overrides.timestamp,
    level: "INFO" as const,
    message: "Fetched cart",
    logger: "CONSOLE" as const,
    environment: "production",
    release: null,
    source: "BROWSER" as const,
    sessionId: null,
    url: null,
    deviceType: null,
    os: null,
    browser: null,
    errorName: null,
    context: null,
    errorStack: null,
    userAgent: null,
    errorMessage: null,
    application: { slug: "checkout", name: "Checkout" },
  };
}

/** Every query function under test, with a call that would hit the database. */
const READS = [
  ["listLogEvents", (session: AppSession) => listLogEvents(session, FILTERS)],
  ["getLogEvent", (session: AppSession) => getLogEvent(session, "event-1")],
  [
    "getApplicationActivity",
    (session: AppSession) => getApplicationActivity(session, WINDOW),
  ],
  [
    "listEnvironments",
    (session: AppSession) => listEnvironments(session, "app-1"),
  ],
] as const;

function prismaCallCount(): number {
  return [
    vi.mocked(prisma.$queryRaw),
    vi.mocked(prisma.logEvent.findMany),
    vi.mocked(prisma.logEvent.findUnique),
    vi.mocked(prisma.application.findMany),
    vi.mocked(prisma.application.findUnique),
  ].reduce((total, mock) => total + mock.mock.calls.length, 0);
}

/**
 * The pieces of a tagged-template call: the literal SQL with the parameter
 * slots joined back together, and the values bound into those slots.
 */
function rawCall(index = 0): { sql: string; values: unknown[] } {
  const call = vi.mocked(prisma.$queryRaw).mock.calls[index];
  if (call === undefined) throw new Error(`no $queryRaw call #${index}`);

  const [strings, ...values] = call;
  if (!Array.isArray(strings)) throw new Error("not a tagged template call");

  return { sql: strings.join("?"), values };
}

beforeEach(() => {
  // The doubles come from a module factory, so `restoreMocks` does not reset
  // their call records: the counts below would otherwise carry between tests.
  vi.clearAllMocks();

  vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
  vi.mocked(prisma.logEvent.findMany).mockResolvedValue([]);
  vi.mocked(prisma.logEvent.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.application.findMany).mockResolvedValue([]);
  vi.mocked(prisma.application.findUnique).mockResolvedValue(null);
});

describe.each(READS)("%s", (_name, read) => {
  it("refuses an anonymous caller", async () => {
    await expect(read(ANONYMOUS_SESSION)).rejects.toBeInstanceOf(ApiError);
  });

  it("refuses a deactivated user with UNAUTHORIZED", async () => {
    await expect(read(DEACTIVATED_SESSION)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("refuses a deactivated ADMIN — the role does not survive deactivation", async () => {
    await expect(read(DEACTIVATED_ADMIN_SESSION)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("issues no query at all when it refuses", async () => {
    for (const session of [
      ANONYMOUS_SESSION,
      DEACTIVATED_SESSION,
      DEACTIVATED_ADMIN_SESSION,
    ]) {
      await expect(read(session)).rejects.toBeInstanceOf(ApiError);
    }

    expect(prismaCallCount()).toBe(0);
  });

  it("queries for a live MEMBER, proving the gate is what refused", async () => {
    await read(MEMBER_SESSION);

    expect(prismaCallCount()).toBeGreaterThan(0);
  });

  it("queries for a live ADMIN too — reading logs is not an admin capability", async () => {
    await read(ADMIN_SESSION);

    expect(prismaCallCount()).toBeGreaterThan(0);
  });
});

describe("listLogEvents", () => {
  const CURSOR_TS = new Date("2026-10-16T11:49:09.531Z");
  const CURSOR_ID = "c0000000000000000003d0905";

  function findManyArgs(): Record<string, unknown> {
    const call = vi.mocked(prisma.logEvent.findMany).mock.calls[0];
    if (call?.[0] === undefined) throw new Error("findMany was not called");
    return call[0] as Record<string, unknown>;
  }

  describe("keyset paging", () => {
    it("queries the newest page with no bound and one row of look-ahead", async () => {
      await listLogEvents(MEMBER_SESSION, { limit: 50 });

      const args = findManyArgs();
      expect(args.where).toEqual({});
      expect(args.take).toBe(51);
      expect(args).not.toHaveProperty("cursor");
      expect(args).not.toHaveProperty("skip");
      expect(args.orderBy).toEqual([{ timestamp: "desc" }, { id: "desc" }]);
    });

    it("turns a cursor into a (timestamp, id) bound, never a Prisma cursor/skip", async () => {
      await listLogEvents(MEMBER_SESSION, {
        limit: 50,
        level: ["error"],
        cursor: encodeLogCursor({ ts: CURSOR_TS, id: CURSOR_ID }),
      });

      const args = findManyArgs();
      expect(args.where).toEqual({
        AND: [
          { level: { in: ["ERROR"] } },
          { timestamp: { lte: CURSOR_TS } },
          { OR: [{ timestamp: { lt: CURSOR_TS } }, { id: { lt: CURSOR_ID } }] },
        ],
      });
      expect(args.take).toBe(51);
      expect(args).not.toHaveProperty("cursor");
      expect(args).not.toHaveProperty("skip");
    });

    it("builds the next cursor from the last row returned", async () => {
      const rows = [
        makeRow({ id: "e-3", timestamp: new Date("2026-10-16T11:49:09.531Z") }),
        makeRow({ id: "e-2", timestamp: new Date("2026-10-16T11:49:09.531Z") }),
        makeRow({ id: "e-1", timestamp: new Date("2026-10-16T11:49:08.000Z") }),
      ];
      vi.mocked(prisma.logEvent.findMany).mockResolvedValue(rows);

      const page = await listLogEvents(MEMBER_SESSION, { limit: 2 });

      expect(page.hasMore).toBe(true);
      expect(page.items.map((item) => item.id)).toEqual(["e-3", "e-2"]);
      expect(page.nextCursor).toBe(
        encodeLogCursor({
          ts: new Date("2026-10-16T11:49:09.531Z"),
          id: "e-2",
        }),
      );
    });

    it("returns no cursor on the last page", async () => {
      vi.mocked(prisma.logEvent.findMany).mockResolvedValue([
        makeRow({ id: "e-1", timestamp: CURSOR_TS }),
      ]);

      const page = await listLogEvents(MEMBER_SESSION, { limit: 2 });

      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it("refuses a cursor the validator could not have produced, without querying", async () => {
      await expect(
        listLogEvents(MEMBER_SESSION, { limit: 50, cursor: "event-1" }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });

      expect(prismaCallCount()).toBe(0);
    });
  });

  describe("application scope", () => {
    it("resolves a slug to its id with one lookup, then filters by id alone", async () => {
      vi.mocked(prisma.application.findUnique).mockResolvedValue({
        id: "app-checkout",
      } as never);

      await listLogEvents(MEMBER_SESSION, {
        limit: 50,
        applicationSlug: "checkout",
      });

      expect(prisma.application.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.application.findUnique).toHaveBeenCalledWith({
        where: { slug: "checkout" },
        select: { id: true },
      });
      expect(findManyArgs().where).toEqual({ applicationId: "app-checkout" });
    });

    it("answers an unknown slug with an empty page and never touches log_events", async () => {
      const page = await listLogEvents(MEMBER_SESSION, {
        limit: 50,
        applicationSlug: "nope",
      });

      expect(page).toEqual({ items: [], hasMore: false, nextCursor: null });
      expect(prisma.application.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.logEvent.findMany).not.toHaveBeenCalled();
    });

    it("answers an id and a slug that disagree with an empty page", async () => {
      vi.mocked(prisma.application.findUnique).mockResolvedValue({
        id: "app-checkout",
      } as never);

      const page = await listLogEvents(MEMBER_SESSION, {
        limit: 50,
        applicationId: "app-portal",
        applicationSlug: "checkout",
      });

      expect(page.items).toEqual([]);
      expect(prisma.logEvent.findMany).not.toHaveBeenCalled();
    });

    it("does not look anything up when only an id is given", async () => {
      await listLogEvents(MEMBER_SESSION, {
        limit: 50,
        applicationId: "app-checkout",
      });

      expect(prisma.application.findUnique).not.toHaveBeenCalled();
      expect(findManyArgs().where).toEqual({ applicationId: "app-checkout" });
    });
  });
});

describe("getApplicationActivity", () => {
  it("aggregates both counts in one statement over the server receipt window", async () => {
    await getApplicationActivity(MEMBER_SESSION, WINDOW);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const { sql, values } = rawCall();
    expect(sql).toContain('"receivedAt"');
    expect(sql).toContain("FILTER");
    expect(values).toContain(WINDOW.from);
    expect(values).toContain(WINDOW.to);
    expect(sql).not.toContain('"timestamp"');
  });

  it("binds the error levels rather than spelling them into the SQL", async () => {
    await getApplicationActivity(MEMBER_SESSION, WINDOW);

    const { sql, values } = rawCall();
    expect(values).toContainEqual(["ERROR", "FATAL"]);
    expect(sql).not.toMatch(/'ERROR'|'FATAL'/);
  });

  it("joins application names and sorts busiest first", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { applicationId: "app-portal", eventCount: 10, errorCount: 1 },
      { applicationId: "app-checkout", eventCount: 100, errorCount: 7 },
    ]);
    vi.mocked(prisma.application.findMany).mockResolvedValue([
      { id: "app-checkout", slug: "checkout", name: "Checkout" },
      { id: "app-portal", slug: "portal", name: "Portal" },
    ] as never);

    const activity = await getApplicationActivity(MEMBER_SESSION, WINDOW);

    expect(activity).toEqual([
      {
        applicationId: "app-checkout",
        applicationSlug: "checkout",
        applicationName: "Checkout",
        eventCount: 100,
        errorCount: 7,
      },
      {
        applicationId: "app-portal",
        applicationSlug: "portal",
        applicationName: "Portal",
        eventCount: 10,
        errorCount: 1,
      },
    ]);
  });

  it("labels an application the registry no longer knows", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { applicationId: "app-gone", eventCount: 3, errorCount: 0 },
    ]);

    const activity = await getApplicationActivity(MEMBER_SESSION, WINDOW);

    expect(activity[0]).toMatchObject({
      applicationSlug: "unknown",
      applicationName: "Unknown application",
    });
  });
});

describe("listEnvironments", () => {
  it("walks one application's index with the id bound as a parameter", async () => {
    await listEnvironments(MEMBER_SESSION, "app-1");

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const { sql, values } = rawCall();
    expect(sql).toContain("WITH RECURSIVE");
    // The id twice (seed and step of the walk), then the bound LIMIT.
    expect(values).toEqual(["app-1", "app-1", expect.any(Number)]);
  });

  it("walks every application's index when none is given", async () => {
    await listEnvironments(MEMBER_SESSION);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const { sql, values } = rawCall();
    expect(sql).toContain("CROSS JOIN LATERAL");
    // No id at all — only the two bound LIMITs.
    expect(values).toEqual([expect.any(Number), expect.any(Number)]);
    expect(values).not.toContain("app-1");
  });

  it("returns the names sorted", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { environment: "staging" },
      { environment: "development" },
      { environment: "production" },
    ]);

    await expect(listEnvironments(MEMBER_SESSION, "app-1")).resolves.toEqual([
      "development",
      "production",
      "staging",
    ]);
  });
});
