import type { Prisma } from "@prisma/client";

import type { UserRole } from "@/lib/auth/types";
import { prisma } from "@/lib/db";

import {
  checkDeactivation,
  checkPasswordReset,
  checkRoleChange,
  confirmsEmail,
} from "./guards";
import type { UserGuardRefusal } from "./guards";
import { endAllSessions, issueTemporaryPassword } from "./provisioning";
import type { IssuedPassword } from "./provisioning";

/**
 * The per-user admin operations: change role, deactivate, reactivate, reset
 * password.
 *
 * No access checks here — the Server Actions run `requireAdminCaller` first
 * and pass the ACTING user's id in from the session. What lives here is the
 * part that has to be right under concurrency: the guards in `./guards.ts`
 * are evaluated against the database INSIDE the write's transaction.
 *
 * WHY SERIALIZABLE. "Is this the last active admin?" is a count, and two
 * admins demoting each other at the same moment would each count two, each
 * pass, and leave none. Under Postgres' serializable isolation the second
 * commit of that pair fails with a serialization error instead, which is
 * reported back as a `CONFLICT` to retry rather than silently applied.
 */

/** Columns the operations read about their target. Never a credential. */
const TARGET_SELECT = {
  id: true,
  email: true,
  role: true,
  isActive: true,
} as const satisfies Prisma.UserSelect;

/** The target as read. */
export type LifecycleTarget = Prisma.UserGetPayload<{
  select: typeof TARGET_SELECT;
}>;

/** Why an operation did not go ahead. */
export type LifecycleRefusal =
  "NOT_FOUND" | "CONFIRMATION_MISMATCH" | "CONFLICT" | UserGuardRefusal;

/** The outcome of a role change, deactivation or reactivation. */
export type LifecycleOutcome =
  | {
      ok: true;
      target: LifecycleTarget;
      /** False when the user was already in the requested state. */
      changed: boolean;
    }
  | { ok: false; reason: LifecycleRefusal };

/** The outcome of a password reset. */
export type ResetOutcome =
  | { ok: true; target: LifecycleTarget; issued: IssuedPassword }
  | { ok: false; reason: LifecycleRefusal };

/** Prisma's "transaction failed due to a write conflict or deadlock". */
const SERIALIZATION_FAILURE_CODE = "P2034";

/** Active administrators — the population the last-admin guard protects. */
const ACTIVE_ADMIN_WHERE = {
  role: "ADMIN",
  isActive: true,
} as const satisfies Prisma.UserWhereInput;

function refuse(reason: LifecycleRefusal): LifecycleOutcome {
  return { ok: false, reason };
}

function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === SERIALIZATION_FAILURE_CODE
  );
}

/**
 * Runs a guarded read-decide-write in one serializable transaction.
 *
 * @param work - The transaction body.
 * @returns Its outcome, or `CONFLICT` when Postgres refused to serialise it.
 */
async function inGuardedTransaction(
  work: (tx: Prisma.TransactionClient) => Promise<LifecycleOutcome>,
): Promise<LifecycleOutcome> {
  try {
    return await prisma.$transaction(work, {
      isolationLevel: "Serializable",
    });
  } catch (error) {
    if (isSerializationFailure(error)) return refuse("CONFLICT");
    throw error;
  }
}

/**
 * Changes a user's role.
 *
 * @param actorId - The acting administrator, FROM THE SESSION.
 * @param targetId - The user to change, validated but untrusted.
 * @param nextRole - The role to give them, validated against `USER_ROLES`.
 * @returns The outcome.
 */
export async function changeUserRole(
  actorId: string,
  targetId: string,
  nextRole: UserRole,
): Promise<LifecycleOutcome> {
  return inGuardedTransaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: targetId },
      select: TARGET_SELECT,
    });
    if (target === null) return refuse("NOT_FOUND");

    const activeAdmins = await tx.user.count({ where: ACTIVE_ADMIN_WHERE });
    const refusal = checkRoleChange(actorId, target, nextRole, activeAdmins);
    if (refusal !== null) return refuse(refusal);

    if (target.role === nextRole) return { ok: true, target, changed: false };

    await tx.user.update({
      where: { id: target.id },
      data: { role: nextRole },
      select: { id: true },
    });

    return { ok: true, target, changed: true };
  });
}

/**
 * Deactivates a user and signs them out everywhere.
 *
 * `isActive = false` is what actually locks them out: `getSession` re-reads
 * the user on every request and every gate refuses an inactive account, so
 * the switch takes effect on their next request. Their sessions are deleted
 * as well, AFTER the flag commits, so nothing is left to present even if a
 * future change loosens a gate.
 *
 * @param actorId - The acting administrator, FROM THE SESSION.
 * @param targetId - The user to deactivate.
 * @param confirmEmail - The target's address, retyped by the administrator.
 * @returns The outcome.
 */
export async function deactivateUser(
  actorId: string,
  targetId: string,
  confirmEmail: string,
): Promise<LifecycleOutcome> {
  const outcome = await inGuardedTransaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: targetId },
      select: TARGET_SELECT,
    });
    if (target === null) return refuse("NOT_FOUND");
    if (!confirmsEmail(confirmEmail, target.email)) {
      return refuse("CONFIRMATION_MISMATCH");
    }

    const activeAdmins = await tx.user.count({ where: ACTIVE_ADMIN_WHERE });
    const refusal = checkDeactivation(actorId, target, activeAdmins);
    if (refusal !== null) return refuse(refusal);

    if (!target.isActive) return { ok: true, target, changed: false };

    await tx.user.update({
      where: { id: target.id },
      data: { isActive: false },
      select: { id: true },
    });

    return { ok: true, target, changed: true };
  });

  if (outcome.ok) await endAllSessions(outcome.target.id);

  return outcome;
}

/**
 * Reactivates a user.
 *
 * Unguarded beyond existence: turning an account ON can never strand the
 * organisation, and an admin cannot be inactive and acting at once.
 *
 * @param targetId - The user to reactivate.
 * @returns The outcome.
 */
export async function reactivateUser(
  targetId: string,
): Promise<LifecycleOutcome> {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: TARGET_SELECT,
  });
  if (target === null) return refuse("NOT_FOUND");
  if (target.isActive) return { ok: true, target, changed: false };

  await prisma.user.update({
    where: { id: target.id },
    data: { isActive: true },
    select: { id: true },
  });

  return { ok: true, target, changed: true };
}

/**
 * Replaces (or, for a Google-only user, adds) a user's password with a fresh
 * temporary one, and signs them out everywhere.
 *
 * The sessions go because a reset is what an administrator does when an
 * account may be in the wrong hands: whoever holds a live session must not
 * keep it past the credential that created it.
 *
 * @param actorId - The acting administrator, FROM THE SESSION.
 * @param targetId - The user to reset.
 * @param confirmEmail - The target's address, retyped by the administrator.
 * @returns The temporary password to show once, or a refusal.
 */
export async function resetUserPassword(
  actorId: string,
  targetId: string,
  confirmEmail: string,
): Promise<ResetOutcome> {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: TARGET_SELECT,
  });
  if (target === null) return { ok: false, reason: "NOT_FOUND" };
  if (!confirmsEmail(confirmEmail, target.email)) {
    return { ok: false, reason: "CONFIRMATION_MISMATCH" };
  }

  const refusal = checkPasswordReset(actorId, target);
  if (refusal !== null) return { ok: false, reason: refusal };

  const issued = await issueTemporaryPassword(target.id);
  await endAllSessions(target.id);

  return { ok: true, target, issued };
}
