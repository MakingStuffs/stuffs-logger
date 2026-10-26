import type { Prisma } from "@prisma/client";

import { assertAdminViewer } from "@/lib/access";
import type { AppSession } from "@/lib/auth/types";
import { prisma } from "@/lib/db";

import type { ApiTokenSummary } from "./dto";

/**
 * API-token reads.
 *
 * ADMIN ONLY, like the mutations: a token is a live machine credential, and
 * even its label and last-used time say which jobs exist and when they run.
 * The session is passed in so "who is asking" is part of the signature.
 */

/**
 * Columns a token listing exposes.
 *
 * `tokenHash` is deliberately ABSENT. It is the stored form of a live
 * credential and has no use in any UI; no selector in this module names it.
 */
const API_TOKEN_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const satisfies Prisma.ApiTokenSelect;

type ApiTokenRow = Prisma.ApiTokenGetPayload<{
  select: typeof API_TOKEN_SELECT;
}>;

function toApiTokenSummary(row: ApiTokenRow): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * Every API token, live and revoked.
 *
 * Revoked tokens stay listed so an operator can see a credential was
 * switched off rather than wondering whether it ever existed.
 *
 * @param session - The resolved session of the user asking.
 * @returns Tokens newest first, never carrying a digest.
 * @throws {ApiError} `UNAUTHORIZED` for an inactive account, `FORBIDDEN` for a
 *   live account that is not an administrator — before any query is issued.
 */
export async function listApiTokens(
  session: AppSession,
): Promise<ApiTokenSummary[]> {
  assertAdminViewer(session);

  const rows = await prisma.apiToken.findMany({
    select: API_TOKEN_SELECT,
    orderBy: { createdAt: "desc" },
  });

  return rows.map(toApiTokenSummary);
}
