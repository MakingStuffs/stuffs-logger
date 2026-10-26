import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "@/lib/auth/session";
import type { AppSession, AppUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db";

import {
  createApplicationAction,
  deleteApplicationAction,
  updateApplicationAction,
} from "./application-actions";
import type { ApplicationActionResult } from "./application-actions";
import { purgeApplication } from "./purge-application";

/**
 * Boundary mocks only, as in `./actions.test.ts`: the session seam, the
 * database client, Next's cache and navigation, and the batched delete (which
 * has its own suite). The role check and the schemas run for real.
 *
 * `redirect` is replaced by a function that THROWS, as the real one does, so
 * a test proves the action stops there rather than carrying on past it.
 */
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new RedirectSignal(path);
  }),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    application: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock("./purge-application", () => ({ purgeApplication: vi.fn() }));

/** What the mocked `redirect` throws, carrying where it was sent. */
class RedirectSignal extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
}

const IDLE: ApplicationActionResult = { status: "idle" };

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

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("database refused", {
    code,
    clientVersion: "test",
  });
}

/** Runs an action that is expected to redirect, and returns where to. */
async function redirectTarget(
  run: () => Promise<ApplicationActionResult>,
): Promise<string> {
  const error: unknown = await run().then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof RedirectSignal)) {
    throw new Error("the action returned instead of redirecting");
  }
  return error.path;
}

function fieldErrorsOf(
  result: ApplicationActionResult,
): Record<string, string[] | undefined> | undefined {
  return result.status === "error" ? result.fieldErrors : undefined;
}

/** Every way a caller can be refused before the action does anything. */
const REFUSED_CALLERS = [
  ["an anonymous caller", signedOut, "You need to sign in again."],
  [
    "a caller whose account has been deactivated",
    signedInButDeactivated,
    "Your account is no longer active.",
  ],
  [
    "a MEMBER, who may read applications but not change them",
    () => signedInAs(makeSession({ role: "MEMBER" })),
    "Only an administrator can do this.",
  ],
  [
    "a deactivated ADMIN",
    () => signedInAs(makeSession({ isActive: false })),
    "Your account is no longer active.",
  ],
] as const;

const VALID_CREATE = {
  name: "Billing",
  slug: "billing",
  description: "Invoices and payment runs.",
};

const VALID_UPDATE = {
  applicationId: "app-1",
  name: "Billing service",
  description: "Invoices, refunds and payment runs.",
};

const VALID_DELETE = { applicationId: "app-1", confirmSlug: "billing" };

beforeEach(() => {
  // Factory mocks keep call history between tests; `restoreMocks` covers
  // spies only.
  vi.clearAllMocks();
  signedInAs(makeSession());
  vi.mocked(prisma.application.create).mockResolvedValue({
    slug: "billing",
  } as never);
  vi.mocked(prisma.application.update).mockResolvedValue({
    slug: "billing",
    name: "Billing service",
  } as never);
  vi.mocked(prisma.application.findUnique).mockResolvedValue({
    id: "app-1",
    slug: "billing",
  } as never);
  vi.mocked(purgeApplication).mockResolvedValue({
    complete: true,
    deletedEvents: 42,
  });
});

describe("createApplicationAction — access", () => {
  it.each(REFUSED_CALLERS)(
    "refuses %s and writes nothing",
    async (_label, arrange, message) => {
      arrange();

      const result = await createApplicationAction(IDLE, formOf(VALID_CREATE));

      expect(result).toEqual({ status: "error", message });
      expect(prisma.application.create).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    },
  );

  it("refuses before validating, so a refused caller learns nothing about the schema", async () => {
    signedInAs(makeSession({ role: "MEMBER" }));

    const result = await createApplicationAction(
      IDLE,
      formOf({ ...VALID_CREATE, name: "" }),
    );

    expect(fieldErrorsOf(result)).toBeUndefined();
  });
});

describe("createApplicationAction — validation", () => {
  it("requires a name", async () => {
    const result = await createApplicationAction(
      IDLE,
      formOf({ ...VALID_CREATE, name: "   " }),
    );

    expect(fieldErrorsOf(result)?.name).toBeDefined();
    expect(prisma.application.create).not.toHaveBeenCalled();
  });

  it("refuses a name longer than 64 characters", async () => {
    const result = await createApplicationAction(
      IDLE,
      formOf({ ...VALID_CREATE, name: "n".repeat(65) }),
    );

    expect(fieldErrorsOf(result)?.name).toBeDefined();
    expect(prisma.application.create).not.toHaveBeenCalled();
  });

  it.each(["", "Billing", "-billing", "bill ing", "bill/ing", "b".repeat(65)])(
    "refuses the slug %j",
    async (slug) => {
      const result = await createApplicationAction(
        IDLE,
        formOf({ ...VALID_CREATE, slug }),
      );

      expect(fieldErrorsOf(result)?.slug).toBeDefined();
      expect(prisma.application.create).not.toHaveBeenCalled();
    },
  );

  it("refuses a description longer than 280 characters", async () => {
    const result = await createApplicationAction(
      IDLE,
      formOf({ ...VALID_CREATE, description: "d".repeat(281) }),
    );

    expect(fieldErrorsOf(result)?.description).toBeDefined();
    expect(prisma.application.create).not.toHaveBeenCalled();
  });

  it("reports a slug another application holds against the slug field, not as a fault", async () => {
    vi.mocked(prisma.application.create).mockRejectedValue(
      prismaError("P2002"),
    );

    const result = await createApplicationAction(IDLE, formOf(VALID_CREATE));

    expect(result).toEqual({
      status: "error",
      message: "Choose a different slug.",
      fieldErrors: { slug: ["Another application already uses this slug."] },
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("lets any other database failure through to the error boundary", async () => {
    vi.mocked(prisma.application.create).mockRejectedValue(
      prismaError("P1001"),
    );

    await expect(
      createApplicationAction(IDLE, formOf(VALID_CREATE)),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});

describe("createApplicationAction — success", () => {
  it("creates the application and opens its page", async () => {
    const target = await redirectTarget(() =>
      createApplicationAction(IDLE, formOf(VALID_CREATE)),
    );

    expect(target).toBe("/apps/billing");
    expect(prisma.application.create).toHaveBeenCalledWith({
      data: {
        name: "Billing",
        slug: "billing",
        description: "Invoices and payment runs.",
      },
      select: { slug: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/apps");
  });

  it("stores a blank description as none", async () => {
    await redirectTarget(() =>
      createApplicationAction(
        IDLE,
        formOf({ ...VALID_CREATE, description: "   " }),
      ),
    );

    expect(prisma.application.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: null }),
      }),
    );
  });

  it("ignores fields the form does not define", async () => {
    await redirectTarget(() =>
      createApplicationAction(
        IDLE,
        formOf({ ...VALID_CREATE, id: "chosen-id", createdAt: "1970-01-01" }),
      ),
    );

    const data = vi.mocked(prisma.application.create).mock.calls[0]?.[0].data;
    expect(Object.keys(data ?? {}).sort()).toEqual([
      "description",
      "name",
      "slug",
    ]);
  });
});

describe("updateApplicationAction", () => {
  it.each(REFUSED_CALLERS)(
    "refuses %s and writes nothing",
    async (_label, arrange, message) => {
      arrange();

      const result = await updateApplicationAction(IDLE, formOf(VALID_UPDATE));

      expect(result).toEqual({ status: "error", message });
      expect(prisma.application.update).not.toHaveBeenCalled();
    },
  );

  it("requires a name", async () => {
    const result = await updateApplicationAction(
      IDLE,
      formOf({ ...VALID_UPDATE, name: "" }),
    );

    expect(fieldErrorsOf(result)?.name).toBeDefined();
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  it("refuses a description longer than 280 characters", async () => {
    const result = await updateApplicationAction(
      IDLE,
      formOf({ ...VALID_UPDATE, description: "d".repeat(281) }),
    );

    expect(fieldErrorsOf(result)?.description).toBeDefined();
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  it("never changes the slug, even when one is submitted", async () => {
    await updateApplicationAction(
      IDLE,
      formOf({ ...VALID_UPDATE, slug: "renamed" }),
    );

    const data = vi.mocked(prisma.application.update).mock.calls[0]?.[0].data;
    expect(data).not.toHaveProperty("slug");
  });

  it("saves the name and description and revalidates both pages", async () => {
    const result = await updateApplicationAction(IDLE, formOf(VALID_UPDATE));

    expect(result).toEqual({ status: "updated", name: "Billing service" });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: "app-1" },
      data: {
        name: "Billing service",
        description: "Invoices, refunds and payment runs.",
      },
      select: { slug: true, name: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/apps");
    expect(revalidatePath).toHaveBeenCalledWith("/apps/billing");
  });

  it("clears the description when it is submitted blank", async () => {
    await updateApplicationAction(
      IDLE,
      formOf({ ...VALID_UPDATE, description: "" }),
    );

    expect(prisma.application.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: "Billing service", description: null },
      }),
    );
  });

  it("reports an application deleted in the meantime", async () => {
    vi.mocked(prisma.application.update).mockRejectedValue(
      prismaError("P2025"),
    );

    const result = await updateApplicationAction(IDLE, formOf(VALID_UPDATE));

    expect(result).toEqual({
      status: "error",
      message: "That application no longer exists.",
    });
  });
});

describe("deleteApplicationAction", () => {
  it.each(REFUSED_CALLERS)(
    "refuses %s and deletes nothing",
    async (_label, arrange, message) => {
      arrange();

      const result = await deleteApplicationAction(IDLE, formOf(VALID_DELETE));

      expect(result).toEqual({ status: "error", message });
      expect(prisma.application.findUnique).not.toHaveBeenCalled();
      expect(purgeApplication).not.toHaveBeenCalled();
    },
  );

  it("refuses a submission with no typed confirmation", async () => {
    const result = await deleteApplicationAction(
      IDLE,
      formOf({ ...VALID_DELETE, confirmSlug: "" }),
    );

    expect(fieldErrorsOf(result)?.confirmSlug).toBeDefined();
    expect(purgeApplication).not.toHaveBeenCalled();
  });

  it("refuses when the typed slug does not match the application", async () => {
    const result = await deleteApplicationAction(
      IDLE,
      formOf({ ...VALID_DELETE, confirmSlug: "billing-old" }),
    );

    expect(result).toEqual({
      status: "error",
      message: "The slug you typed does not match this application.",
      fieldErrors: { confirmSlug: ["Type the application's slug exactly."] },
    });
    expect(purgeApplication).not.toHaveBeenCalled();
  });

  it("refuses an application's NAME typed in place of its slug", async () => {
    const result = await deleteApplicationAction(
      IDLE,
      formOf({ ...VALID_DELETE, confirmSlug: "Billing" }),
    );

    expect(result.status).toBe("error");
    expect(purgeApplication).not.toHaveBeenCalled();
  });

  it("reports an application that no longer exists", async () => {
    vi.mocked(prisma.application.findUnique).mockResolvedValue(null);

    const result = await deleteApplicationAction(IDLE, formOf(VALID_DELETE));

    expect(result).toEqual({
      status: "error",
      message: "That application no longer exists.",
    });
    expect(purgeApplication).not.toHaveBeenCalled();
  });

  it("deletes the application and returns to the list", async () => {
    const target = await redirectTarget(() =>
      deleteApplicationAction(IDLE, formOf(VALID_DELETE)),
    );

    expect(target).toBe("/apps");
    expect(purgeApplication).toHaveBeenCalledWith("app-1");
    expect(revalidatePath).toHaveBeenCalledWith("/apps");
  });

  it("tells the admin to retry when the time budget runs out, and stays put", async () => {
    vi.mocked(purgeApplication).mockResolvedValue({
      complete: false,
      deletedEvents: 250_000,
    });

    const result = await deleteApplicationAction(IDLE, formOf(VALID_DELETE));

    expect(result.status).toBe("error");
    expect(result.status === "error" ? result.message : "").toMatch(
      /delete it again/,
    );
    expect(redirect).not.toHaveBeenCalled();
  });
});
