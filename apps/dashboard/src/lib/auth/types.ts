/**
 * The session shapes this app owns.
 *
 * Written as explicit declarations rather than derived from Better Auth's
 * `$Infer`, because this is the contract every access gate in the codebase is
 * reviewed against: an auditable shape beats an inferred one for a security
 * layer, and the runtime schema in `./session.ts` validates against exactly
 * these fields so the two cannot silently disagree.
 *
 * Browser-safe: types only, no imports, no runtime surface.
 */

/** The roles a user can hold. Two, because there are two things to decide. */
export const USER_ROLES = ["ADMIN", "MEMBER"] as const;

/**
 * What a user may do.
 *
 * `MEMBER` reads logs and applications; `ADMIN` additionally manages ingest
 * keys, which are write credentials. There is no client/tenant scope any more
 * — the user table is exclusively this company's staff.
 */
export type UserRole = (typeof USER_ROLES)[number];

/** The authenticated user attached to a resolved session. */
export interface AppUser {
  /** Stable id. */
  id: string;
  /** Email address (unique). */
  email: string;
  /** Display name. */
  name: string;
  /** What the user may do. */
  role: UserRole;
  /** Avatar URL, when set. */
  image: string | null;
  /** Whether the account is still live. A deactivated account reads nothing. */
  isActive: boolean;
  /** Row creation timestamp. */
  createdAt: Date;
  /** Row last-updated timestamp. */
  updatedAt: Date;
}

/** The database-backed session record (the session, not the user). */
export interface AppSessionRecord {
  /** Session id. */
  id: string;
  /** The signed session token. */
  token: string;
  /** The owning user's id. */
  userId: string;
  /** Absolute expiry. */
  expiresAt: Date;
  /** Row creation timestamp. */
  createdAt: Date;
  /** Row last-updated timestamp. */
  updatedAt: Date;
  /** Originating IP, when captured. */
  ipAddress: string | null;
  /** Originating user agent, when captured. */
  userAgent: string | null;
}

/** A fully-resolved session: who is asking, and which session says so. */
export interface AppSession {
  /** The authenticated user. */
  user: AppUser;
  /** The session record backing them. */
  session: AppSessionRecord;
}

/**
 * Why a caller was refused.
 *
 * - `UNAUTHENTICATED` — no usable identity: signed out, expired, malformed, or
 *   any fail-closed path. Carries no session.
 * - `INACTIVE` — a real, current session whose account has been deactivated.
 *   Carries the session, so a page can say "signed in as X, deactivated"
 *   rather than bouncing them into a sign-in they have already completed.
 */
export type SessionDenialReason = "UNAUTHENTICATED" | "INACTIVE";

/**
 * What `getSession` resolves to.
 *
 * A DISCRIMINATED UNION, never a nullable session, and that is a deliberate
 * safety property: the refused arm is an object, so `if (result)` is truthy
 * for a caller who was denied. Every consumer narrows on `hasAccess`, which
 * makes reading `session` off a refusal a compile error on the granted-only
 * paths and an explicit decision everywhere else.
 */
export type SessionAccessResult =
  | { hasAccess: true; session: AppSession }
  | {
      hasAccess: false;
      reason: SessionDenialReason;
      session: AppSession | null;
    };
