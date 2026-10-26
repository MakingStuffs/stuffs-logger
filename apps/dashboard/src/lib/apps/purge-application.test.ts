import { beforeEach, describe, expect, it, vi } from "vitest";

import { RETENTION_DELETE_BATCH_SIZE } from "@/constants/retention";
import { prisma } from "@/lib/db";

import { purgeApplication } from "./purge-application";

/**
 * The batched delete, against a database double. What is under test is the
 * ORDER and the BUDGET: events in batches until one comes back short, and the
 * application row only after that — never when the budget ran out first.
 */
vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: vi.fn(),
    application: { deleteMany: vi.fn() },
  },
}));

/** A clock that advances by `stepMs` every time it is read. */
function steppingClock(stepMs: number): () => number {
  let now = 0;
  return () => {
    const current = now;
    now += stepMs;
    return current;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.application.deleteMany).mockResolvedValue({ count: 1 });
});

describe("purgeApplication", () => {
  it("deletes the events in batches until one comes back short, then the application", async () => {
    vi.mocked(prisma.$executeRaw)
      .mockResolvedValueOnce(RETENTION_DELETE_BATCH_SIZE)
      .mockResolvedValueOnce(RETENTION_DELETE_BATCH_SIZE)
      .mockResolvedValueOnce(12);

    const result = await purgeApplication("app-1", { clock: () => 0 });

    expect(result).toEqual({
      complete: true,
      deletedEvents: RETENTION_DELETE_BATCH_SIZE * 2 + 12,
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
    expect(prisma.application.deleteMany).toHaveBeenCalledWith({
      where: { id: "app-1" },
    });
  });

  it("deletes an application that has no events after one empty batch", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValue(0);

    const result = await purgeApplication("app-1");

    expect(result).toEqual({ complete: true, deletedEvents: 0 });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.application.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("binds the application id as a parameter, never into the SQL text", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValue(0);

    await purgeApplication("app-1'; DROP TABLE applications; --");

    const [query, ...values] =
      vi.mocked(prisma.$executeRaw).mock.calls[0] ?? [];
    // A tagged template: the literal SQL arrives as the strings array, and
    // every interpolation as a separate bound value.
    expect(Array.isArray(query)).toBe(true);
    expect(Array.isArray(query) ? query.join("") : "").not.toContain(
      "DROP TABLE",
    );
    expect(values).toContain("app-1'; DROP TABLE applications; --");
  });

  it("stops when the budget runs out and leaves the application in place", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValue(
      RETENTION_DELETE_BATCH_SIZE,
    );

    const result = await purgeApplication("app-1", {
      budgetMs: 1_000,
      clock: steppingClock(400),
    });

    expect(result.complete).toBe(false);
    expect(result.deletedEvents).toBe(
      RETENTION_DELETE_BATCH_SIZE *
        vi.mocked(prisma.$executeRaw).mock.calls.length,
    );
    expect(prisma.application.deleteMany).not.toHaveBeenCalled();
  });
});
