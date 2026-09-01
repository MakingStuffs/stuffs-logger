import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { IS_PROD } from "@/constants/environment";
import { prisma } from "@/lib/db";

import { USER_ROLES } from "./types";

/**
 * The Better Auth instance. This app is now the sole session authority — there
 * is no portal, no proxy and no second origin to share a cookie with.
 *
 * Everything below is deliberate:
 *
 * - ONE PRISMA CLIENT. The auth tables live in the same database and the same
 *   `src/lib/db.ts` client as the log tables, so there is one connection pool
 *   and one migration history rather than two. Business queries still never
 *   touch the auth models: no selector in `lib/logs` or `lib/apps` names them.
 * - EMAIL AND PASSWORD ALWAYS ON, so the app works with no external
 *   credentials configured at all.
 * - SIGN-UP CLOSED. `role` defaults to `MEMBER`, and a `MEMBER` reads every
 *   application's logs. Open registration would therefore hand anyone with an
 *   email address the contents of every log line in the product, so accounts
 *   are provisioned by an operator rather than self-served.
 * - GOOGLE ONLY WHEN CONFIGURED. Absent credentials must not break startup;
 *   see {@link isGoogleConfigured}.
 * - `role` AND `isActive` ARE NOT CLIENT INPUT. Both are declared
 *   `input: false` with a default, which makes Better Auth substitute the
 *   default and refuse a request that tries to set them — without that, a
 *   sign-up body could name its own role.
 *
 * Server-only: reaches the database and reads request cookies.
 */

/** Session lifetime. Seven days, Better Auth's own default, made explicit. */
const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

/** How often a live session is extended. */
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

/**
 * Whether Google sign-in is available on this deployment.
 *
 * BOTH halves of the credential are required. Configuring one without the
 * other is a half-finished deployment, and offering a button that can only
 * fail is worse than not offering it, so the provider is registered only when
 * the pair is complete.
 *
 * @returns Whether the sign-in page should offer Google.
 */
export function isGoogleConfigured(): boolean {
  return (
    googleClientId !== undefined &&
    googleClientId.length > 0 &&
    googleClientSecret !== undefined &&
    googleClientSecret.length > 0
  );
}

/**
 * Google, or nothing at all.
 *
 * Built as a whole object rather than a conditional key so an unconfigured
 * deployment registers no social provider, instead of registering one with
 * empty strings that fails at redirect time.
 */
const socialProviders = isGoogleConfigured()
  ? {
      google: {
        clientId: googleClientId ?? "",
        clientSecret: googleClientSecret ?? "",
      },
    }
  : {};

export const auth = betterAuth({
  // Falls back to `BETTER_AUTH_URL`, which on this app is its OWN origin.
  baseURL: process.env.BETTER_AUTH_URL,

  database: prismaAdapter(prisma, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    // See the module note: a self-served account can read every log line.
    disableSignUp: true,
  },

  socialProviders,

  user: {
    additionalFields: {
      role: {
        type: [...USER_ROLES],
        required: true,
        // Never accepted from a request body: a sign-up or profile update that
        // named its own role would be a self-service privilege escalation.
        input: false,
        defaultValue: "MEMBER",
      },
      isActive: {
        type: "boolean",
        required: true,
        input: false,
        defaultValue: true,
      },
    },
  },

  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },

  advanced: {
    // SINGLE ORIGIN. `crossSubDomainCookies` is deliberately absent and the
    // cookie is deliberately host-scoped: this app no longer shares a session
    // with anything, so widening the cookie's domain would only widen who can
    // read it.
    useSecureCookies: IS_PROD,
    cookiePrefix: "stuffs-logger",
  },

  // MUST BE LAST: the plugin's after-hook is what copies Better Auth's
  // `Set-Cookie` onto the Next response for `auth.api.*` calls made from a
  // Server Action, and a plugin registered after it would not be covered.
  plugins: [nextCookies()],
});
