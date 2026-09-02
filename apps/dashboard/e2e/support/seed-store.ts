import type { Prisma } from "@prisma/client";

import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";

import { credentialAccountFor } from "./credential-account";
import type { SeedUser, SeedUserRole } from "./fixtures";
import type { SeedIngestKeyRow, SeedStore } from "./seed";

/**
 * The only file in the harness that talks to a database.
 *
 * WHY IT GOES THROUGH BETTER AUTH RATHER THAN STRAIGHT TO PRISMA for the
 * credential half: `emailAndPassword.disableSignUp` is `true` in
 * `src/lib/auth/auth.ts` — deliberately, because a `MEMBER` reads every
 * application's logs — so `auth.api.signUpEmail` refuses and there is no HTTP
 * route that creates a user. `auth.$context` is the supported way in: it
 * resolves to the same `AuthContext` every endpoint handler receives, carrying
 * the configured password hasher and the internal adapter. Verified against
 * the installed better-auth: `Auth.$context` is typed
 * `Promise<AuthContext<Options> & InferPluginContext<Options>>`
 * (`dist/types/auth.d.mts`), and `AuthContext` declares
 * `password: { hash; verify; … }` and `internalAdapter`
 * (`@better-auth/core/dist/types/context.d.mts`).
 *
 * NOTHING HERE HAND-ROLLS A HASH. `ctx.password.hash` is whatever the app is
 * configured to use — the library's scrypt today, a custom hasher the moment
 * anyone configures one — so a seeded password can never be hashed differently
 * from a password set through the product.
 *
 * PRISMA IS USED ONLY FOR THE COLUMNS BETTER AUTH REFUSES. `role` and
 * `isActive` are `input: false`, which makes the library substitute their
 * defaults and reject any attempt to supply them, so an ADMIN fixture has to
 * be promoted on the row after creation.
 */

/** The subset of the auth context this module uses. */
type AuthContext = Awaited<typeof auth.$context>;

async function authContext(): Promise<AuthContext> {
  return auth.$context;
}

/** How Better Auth is told a user was provisioned. */
const PROVISIONING_SOURCE = { method: "email-password" } as const;

/**
 * The store the seeder writes through, backed by Postgres.
 *
 * Every method is a single, named write. There is no general-purpose query
 * method by design: the seeder must not be able to reach a shape this file has
 * not spelled out.
 */
export const prismaSeedStore: SeedStore = {
  async findUserIdByEmail(email: string): Promise<string | null> {
    const row = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });

    return row?.id ?? null;
  },

  async createUserWithPassword(user: SeedUser): Promise<string> {
    const ctx = await authContext();

    // Hashed before the user row exists, exactly as `signUpEmail` does it, so
    // a hasher that rejects the value fails before anything is written.
    const passwordHash = await ctx.password.hash(user.password);

    const created = await ctx.internalAdapter.createUser(
      {
        email: user.email.toLowerCase(),
        name: user.name,
        // Verified, so the fixture keeps working if a deployment ever turns
        // `requireEmailVerification` on. `role` and `isActive` are absent
        // because the library refuses them as input.
        emailVerified: true,
      },
      PROVISIONING_SOURCE,
    );

    await ctx.internalAdapter.linkAccount(
      credentialAccountFor(created.id, passwordHash),
    );

    return created.id;
  },

  async resetPassword(userId: string, password: string): Promise<void> {
    const ctx = await authContext();
    const passwordHash = await ctx.password.hash(password);

    // `updatePassword` matches on the credential triple and updates NOTHING
    // when there is no such row — which is exactly the state a half-finished
    // earlier run leaves behind. The account is therefore looked up first and
    // linked when it is missing, so a reseed always ends with a signable user.
    const existing = await ctx.internalAdapter.findCredentialAccount(userId);

    if (existing === null) {
      await ctx.internalAdapter.linkAccount(
        credentialAccountFor(userId, passwordHash),
      );
      return;
    }

    await ctx.internalAdapter.updatePassword(userId, passwordHash);
  },

  async setRoleAndActivate(userId: string, role: SeedUserRole): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { role, isActive: true },
    });
  },

  async findApplicationIdBySlug(slug: string): Promise<string | null> {
    const row = await prisma.application.findUnique({
      where: { slug },
      select: { id: true },
    });

    return row?.id ?? null;
  },

  async createApplication(input: {
    slug: string;
    name: string;
    description: string;
  }): Promise<string> {
    const row = await prisma.application.create({
      data: input,
      select: { id: true },
    });

    return row.id;
  },

  async deleteIngestKeysByName(
    applicationId: string,
    names: readonly string[],
  ): Promise<void> {
    await prisma.ingestKey.deleteMany({
      where: { applicationId, name: { in: [...names] } },
    });
  },

  async createIngestKey(row: SeedIngestKeyRow): Promise<void> {
    await prisma.ingestKey.create({ data: row });
  },

  async deleteLogEvents(applicationId: string): Promise<void> {
    await prisma.logEvent.deleteMany({ where: { applicationId } });
  },

  async createLogEvents(
    rows: Prisma.LogEventCreateManyInput[],
  ): Promise<number> {
    const result = await prisma.logEvent.createMany({ data: rows });

    return result.count;
  },

  async resetUsage(applicationId: string): Promise<void> {
    await prisma.applicationUsage.deleteMany({ where: { applicationId } });
  },
};

/**
 * Releases the seeder's database connection.
 *
 * The setup project runs in its own worker process; without this the pool
 * keeps the process alive past the last write.
 */
export async function disconnectSeedStore(): Promise<void> {
  await prisma.$disconnect();
}
