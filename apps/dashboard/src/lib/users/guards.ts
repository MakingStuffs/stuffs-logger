import type { UserRole } from "@/lib/auth/types";

/**
 * The two rules that stop user management locking the organisation out.
 *
 * Pure functions, so the rules are unit-tested on their own and the actions
 * cannot each grow a slightly different version of them.
 *
 * 1. NOT YOURSELF. An administrator cannot demote, deactivate or reset
 *    themself from the admin screen. Each is a one-click way to lose the very
 *    access needed to undo it, and resetting your own password belongs on
 *    `/account`, where it needs the current one.
 * 2. NOT THE LAST ADMINISTRATOR. Nobody can demote or deactivate the last
 *    active ADMIN. With rule 1 in place, a single admin acting alone can never
 *    reach this — the case it closes is two admins demoting EACH OTHER at the
 *    same moment, which is why the actions evaluate it inside a serializable
 *    transaction rather than on a count read beforehand.
 */

/** A rule refusal, as a stable code the actions map onto a message. */
export type UserGuardRefusal = "SELF" | "LAST_ADMIN";

/** The facts about the target user the rules need. */
export interface GuardTarget {
  id: string;
  role: UserRole;
  isActive: boolean;
}

/** The messages each refusal is shown as. */
export const USER_GUARD_MESSAGES: Readonly<Record<UserGuardRefusal, string>> = {
  SELF: "You cannot do this to your own account from here. Ask another administrator.",
  LAST_ADMIN:
    "This is the last active administrator. Make someone else an administrator first.",
};

/** Whether the target is someone the acting admin may not act on. */
function isSelf(actorId: string, target: GuardTarget): boolean {
  return actorId === target.id;
}

/**
 * Whether removing this target's admin standing would leave nobody holding it.
 *
 * @param target - The user about to be demoted or deactivated.
 * @param activeAdminCount - Active ADMINs right now, INCLUDING the target.
 */
function isLastActiveAdmin(
  target: GuardTarget,
  activeAdminCount: number,
): boolean {
  return target.role === "ADMIN" && target.isActive && activeAdminCount <= 1;
}

/**
 * Checks a role change.
 *
 * Granting the role a user already holds is not refused here — it is a
 * no-op the action reports as such.
 *
 * @param actorId - The acting administrator, from the session.
 * @param target - The user whose role would change.
 * @param nextRole - The role requested.
 * @param activeAdminCount - Active ADMINs right now, including the target.
 * @returns The refusal, or `null` when the change may go ahead.
 */
export function checkRoleChange(
  actorId: string,
  target: GuardTarget,
  nextRole: UserRole,
  activeAdminCount: number,
): UserGuardRefusal | null {
  if (isSelf(actorId, target)) return "SELF";
  if (nextRole !== "ADMIN" && isLastActiveAdmin(target, activeAdminCount)) {
    return "LAST_ADMIN";
  }

  return null;
}

/**
 * Checks a deactivation.
 *
 * @param actorId - The acting administrator, from the session.
 * @param target - The user who would be deactivated.
 * @param activeAdminCount - Active ADMINs right now, including the target.
 * @returns The refusal, or `null` when it may go ahead.
 */
export function checkDeactivation(
  actorId: string,
  target: GuardTarget,
  activeAdminCount: number,
): UserGuardRefusal | null {
  if (isSelf(actorId, target)) return "SELF";
  if (isLastActiveAdmin(target, activeAdminCount)) return "LAST_ADMIN";

  return null;
}

/**
 * Checks a password reset (or "add a password" for a Google-only user).
 *
 * Only the self rule applies: resetting someone else's password removes
 * nobody's admin standing.
 *
 * @param actorId - The acting administrator, from the session.
 * @param target - The user whose password would be replaced.
 * @returns The refusal, or `null` when it may go ahead.
 */
export function checkPasswordReset(
  actorId: string,
  target: GuardTarget,
): UserGuardRefusal | null {
  return isSelf(actorId, target) ? "SELF" : null;
}

/**
 * Whether a typed confirmation names the target's address.
 *
 * An INTENT check, as on the ingest-key revoke dialog: a valid admin session —
 * or a script running on this origin under one — passes every framework CSRF
 * check, and only a person reading the row can retype what is in it. Case and
 * surrounding space are forgiven because addresses are stored lower-cased and
 * the point is the deliberate act, not the keystrokes.
 *
 * @param typed - What the administrator typed. Untrusted.
 * @param email - The target's stored address.
 * @returns Whether the two name the same address.
 */
export function confirmsEmail(typed: string, email: string): boolean {
  const normalised = typed.trim().toLowerCase();

  return normalised.length > 0 && normalised === email.trim().toLowerCase();
}
