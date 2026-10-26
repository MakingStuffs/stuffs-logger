import type { Prisma } from "@prisma/client";

import { assertActiveViewer, assertAdminViewer } from "@/lib/access";
import type { AppSession } from "@/lib/auth/types";
import { prisma } from "@/lib/db";

import type { OwnAccount, UserSummary } from "./dto";
import { toSignInMethods } from "./sign-in-methods";

/**
 * User reads for `/users` and `/account`.
 *
 * Same rules as every other query module: the session is passed in and
 * asserted FIRST, the query shape is a constant, and rows are projected into a
 * DTO before they leave.
 *
 * THESE ARE THE ONLY QUERIES THAT REACH THE AUTH TABLES, and they reach them
 * narrowly. From `accounts` they read `providerId` alone — enough to say "signs
 * in with a password / with Google" and nothing about the credential. From
 * `sessions` they read `updatedAt` alone, for "last seen". `accounts.password`,
 * the OAuth tokens and `sessions.token` are named by no selector here, which is
 * the surest way for them never to reach a page; the tests pin it.
 */

/** Columns a `/users` row exposes. */
export const USER_LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  accounts: { select: { providerId: true } },
  // The newest session only: `updatedAt` moves when Better Auth extends a
  // session, so it is the best "last active" signal the schema has.
  sessions: {
    select: { updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 1,
  },
} as const satisfies Prisma.UserSelect;

/** Columns `/account` reads about the signed-in user's credentials. */
export const OWN_ACCOUNT_SELECT = {
  providerId: true,
} as const satisfies Prisma.AccountSelect;

type UserListRow = Prisma.UserGetPayload<{ select: typeof USER_LIST_SELECT }>;

function toUserSummary(row: UserListRow): UserSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    signInMethods: toSignInMethods(
      row.accounts.map((account) => account.providerId),
    ),
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.sessions.at(0)?.updatedAt.toISOString() ?? null,
  };
}

/**
 * Every user, for the admin table.
 *
 * ADMIN ONLY: the list names every colleague with access and how they sign in.
 *
 * @param session - The resolved session of the user asking.
 * @returns Users, active first, then by name.
 * @throws {ApiError} `UNAUTHORIZED` for an inactive caller, `FORBIDDEN` for a
 *   member.
 */
export async function listUsers(session: AppSession): Promise<UserSummary[]> {
  assertAdminViewer(session);

  const rows = await prisma.user.findMany({
    select: USER_LIST_SELECT,
    orderBy: [{ isActive: "desc" }, { name: "asc" }, { email: "asc" }],
  });

  return rows.map(toUserSummary);
}

/**
 * The signed-in user's own account, for `/account`.
 *
 * Identity comes from the session (already re-read from the database on this
 * request); only the sign-in methods need a query.
 *
 * @param session - The resolved session of the user asking.
 * @returns What the account page shows.
 * @throws {ApiError} `UNAUTHORIZED` for an anonymous or inactive caller.
 */
export async function getOwnAccount(session: AppSession): Promise<OwnAccount> {
  assertActiveViewer(session);

  const accounts = await prisma.account.findMany({
    where: { userId: session.user.id },
    select: OWN_ACCOUNT_SELECT,
  });

  return {
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
    signInMethods: toSignInMethods(
      accounts.map((account) => account.providerId),
    ),
  };
}
