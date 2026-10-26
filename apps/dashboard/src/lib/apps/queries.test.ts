import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type { AppSession, AppUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db";

import { DAILY_BYTE_QUOTA, DAILY_EVENT_QUOTA } from "@/lib/ingest/quota";

import {
  getApplicationBySlug,
  getApplicationUsageToday,
  listApplications,
  listIngestKeys,
} from "./queries";

/**
 * The gates on application and key reads, proved the same way as the log
 * reads: the database is the only mock, the access check runs for real, and a
 * refusal must happen BEFORE any query is issued.
 *
 * TWO GATES ARE UNDER TEST HERE, and the split is the point of the file.
 * Applications read like logs do, so a live MEMBER may list them. Ingest keys
 * are write credentials for the public ingest endpoint, so a live MEMBER may
 * NOT — and that refusal has its own denial tests below rather than being
 * assumed from the shared ones.
 */
vi.mock("@/lib/db", () => ({
  prisma: {
    application: { findMany: vi.fn(), findUnique: vi.fn() },
    ingestKey: { findMany: vi.fn() },
    applicationUsage: { findUnique: vi.fn() },
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
const ANONYMOUS_SESSION = makeSession({ id: "", email: "", isActive: false });

/** Reads any live staff account may make. */
const ACTIVE_READS = [
  ["listApplications", (session: AppSession) => listApplications(session)],
  [
    "getApplicationBySlug",
    (session: AppSession) => getApplicationBySlug(session, "checkout"),
  ],
  [
    "getApplicationUsageToday",
    (session: AppSession) => getApplicationUsageToday(session, "app-1"),
  ],
] as const;

/** Reads that expose write credentials, and so require an administrator. */
const ADMIN_READS = [
  ["listIngestKeys", (session: AppSession) => listIngestKeys(session, "app-1")],
] as const;

function prismaCallCount(): number {
  return [
    vi.mocked(prisma.application.findMany),
    vi.mocked(prisma.application.findUnique),
    vi.mocked(prisma.ingestKey.findMany),
    vi.mocked(prisma.applicationUsage.findUnique),
  ].reduce((total, mock) => total + mock.mock.calls.length, 0);
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(prisma.application.findMany).mockResolvedValue([]);
  vi.mocked(prisma.application.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.ingestKey.findMany).mockResolvedValue([]);
  vi.mocked(prisma.applicationUsage.findUnique).mockResolvedValue(null);
});

describe.each(ACTIVE_READS)("%s", (_name, read) => {
  it("refuses an anonymous caller", async () => {
    await expect(read(ANONYMOUS_SESSION)).rejects.toBeInstanceOf(ApiError);
  });

  it("refuses a deactivated user with UNAUTHORIZED", async () => {
    await expect(read(DEACTIVATED_SESSION)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("refuses a deactivated ADMIN too", async () => {
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
});

describe.each(ADMIN_READS)("%s", (_name, read) => {
  it("refuses an anonymous caller", async () => {
    await expect(read(ANONYMOUS_SESSION)).rejects.toBeInstanceOf(ApiError);
  });

  it("refuses a live MEMBER with FORBIDDEN", async () => {
    await expect(read(MEMBER_SESSION)).rejects.toMatchObject({
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

  it("refuses a deactivated ADMIN with UNAUTHORIZED, not FORBIDDEN", async () => {
    await expect(read(DEACTIVATED_ADMIN_SESSION)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("issues no query at all when it refuses", async () => {
    for (const session of [
      ANONYMOUS_SESSION,
      MEMBER_SESSION,
      DEACTIVATED_SESSION,
      DEACTIVATED_ADMIN_SESSION,
    ]) {
      await expect(read(session)).rejects.toBeInstanceOf(ApiError);
    }

    expect(prismaCallCount()).toBe(0);
  });

  it("queries for a live ADMIN, proving the gate is what refused", async () => {
    await read(ADMIN_SESSION);

    expect(prismaCallCount()).toBeGreaterThan(0);
  });
});

describe("getApplicationBySlug", () => {
  it("rejects a malformed slug without querying, even for a live caller", async () => {
    const result = await getApplicationBySlug(
      MEMBER_SESSION,
      "../../etc/passwd",
    );

    expect(result).toBeNull();
    expect(prismaCallCount()).toBe(0);
  });
});

describe("getApplicationUsageToday", () => {
  const LATE_EVENING = new Date("2026-10-22T23:45:00.000Z");

  it("reads the row for the current UTC day", async () => {
    await getApplicationUsageToday(MEMBER_SESSION, "app-1", LATE_EVENING);

    expect(prisma.applicationUsage.findUnique).toHaveBeenCalledWith({
      where: {
        applicationId_day: {
          applicationId: "app-1",
          day: new Date("2026-10-22T00:00:00.000Z"),
        },
      },
      select: { eventCount: true, byteCount: true },
    });
  });

  it("reports a day with no row yet as zero, against the ingest ceilings", async () => {
    const usage = await getApplicationUsageToday(
      MEMBER_SESSION,
      "app-1",
      LATE_EVENING,
    );

    expect(usage).toEqual({
      day: "2026-10-22",
      eventCount: 0,
      byteCount: 0,
      eventQuota: DAILY_EVENT_QUOTA,
      byteQuota: DAILY_BYTE_QUOTA,
    });
  });

  it("converts the BigInt byte counter to a plain number", async () => {
    vi.mocked(prisma.applicationUsage.findUnique).mockResolvedValue({
      eventCount: 1_200,
      byteCount: BigInt(52_428_800),
    } as never);

    const usage = await getApplicationUsageToday(
      MEMBER_SESSION,
      "app-1",
      LATE_EVENING,
    );

    expect(usage.eventCount).toBe(1_200);
    expect(usage.byteCount).toBe(52_428_800);
    expect(typeof usage.byteCount).toBe("number");
  });
});
