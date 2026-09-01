import type { AppSession } from "./types";

/**
 * The role predicate, in a module of its own.
 *
 * Deliberately separate from `./session.ts`: the data-access gates in
 * `lib/access.ts` need this answer, and importing it from the facade would
 * drag Better Auth, the Prisma adapter and `next/headers` into the import
 * graph of every query module — and of every test that touches one.
 */

/**
 * Whether a session may manage ingest keys.
 *
 * Activity is part of the answer, not a separate check a call site could
 * forget: a deactivated administrator is not an administrator.
 *
 * @param session - The resolved session.
 * @returns True only for a live account holding `ADMIN`.
 * @example
 * if (!isAdminUser(session)) return refuse();
 */
export function isAdminUser(session: AppSession): boolean {
  return session.user.role === "ADMIN" && session.user.isActive;
}
