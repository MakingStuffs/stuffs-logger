import type { UserRole } from "@/lib/auth/types";

/**
 * The shapes user management hands to pages.
 *
 * Browser-safe: types only. Timestamps are ISO strings so the values cross the
 * server/client boundary unchanged, exactly as the log and application DTOs do.
 *
 * Note what no shape here can carry: a password hash, an OAuth token or a
 * session token. The projections in `./queries.ts` never select them, and a
 * DTO with no field for them is the second wall.
 */

/** How a person signs in, as far as their linked accounts say. */
export interface SignInMethods {
  /** Has a local email-and-password credential. */
  password: boolean;
  /** Has a linked Google account. */
  google: boolean;
  /**
   * Any other provider ids found. Empty on a deployment configured as this one
   * is; surfaced rather than dropped so an unexpected credential is visible.
   */
  other: string[];
}

/** One row of the `/users` table. */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  signInMethods: SignInMethods;
  createdAt: string;
  /**
   * The most recent activity on any of the user's sessions, or `null` when
   * they hold none — never signed in, signed out everywhere, or deactivated
   * (deactivation deletes their sessions).
   */
  lastSeenAt: string | null;
}

/** What `/account` shows the signed-in user about themself. */
export interface OwnAccount {
  name: string;
  email: string;
  role: UserRole;
  signInMethods: SignInMethods;
}
