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
 * - SIGN-UP CLOSED ON BOTH ROUTES. `role` defaults to `MEMBER`, and a `MEMBER`
 *   reads every application's logs. Open registration would therefore hand
 *   anyone with an email address the contents of every log line in the
 *   product, so accounts are provisioned by an operator rather than
 *   self-served. The password route is closed with
 *   `emailAndPassword.disableSignUp`. The Google route is closed SEPARATELY,
 *   on the provider, because Better Auth never consults the password flag
 *   when an OAuth callback arrives for an unknown address — the callback
 *   reads only the provider's own `disableSignUp` and `disableImplicitSignUp`
 *   (`better-auth/dist/api/routes/callback.mjs`, `handleOAuthUserInfo`
 *   call). Without the provider flags, anyone with a Google account would
 *   get an active MEMBER session on their first sign-in.
 * - THE LIBRARY'S OWN PASSWORD ROUTES ARE OFF THE ROUTER. See
 *   {@link DISABLED_AUTH_PATHS}.
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

/**
 * Better Auth routes that would be reachable over HTTP and must not be.
 *
 * The sign-in form never calls these. It goes through `auth.api.signInEmail`
 * from a Server Action, which is where the app's per-account throttle lives
 * (`./sign-in-throttle.ts`). The router mounts them regardless, so a direct
 * `POST /api/auth/sign-in/email` would be a SECOND password-guessing endpoint,
 * limited only by the library's per-instance `ip|path` counter — which keys on
 * a single-value `x-forwarded-for` as-is unless `advanced.ipAddress` says
 * which proxies to trust. A path listed here is answered `404` by the router
 * before rate limiting or any handler runs (`better-auth/dist/api/index.mjs`,
 * `onRequest`); `auth.api.*` calls are not routed and are unaffected.
 *
 * `/sign-up/email` is listed too. `disableSignUp` already refuses it inside
 * the handler; refusing it at the router as well means registration does not
 * reopen if that flag is ever flipped for a provisioning step and forgotten.
 *
 * `/change-password` is listed for the same reason as sign-in: it verifies
 * the CURRENT password, so over HTTP it is a guessing endpoint for anyone
 * holding a session. The account page calls `auth.api.changePassword` from a
 * Server Action that counts attempts through the sign-in throttle first;
 * closing the route leaves that throttled path as the only one.
 */
const DISABLED_AUTH_PATHS = [
  "/sign-in/email",
  "/sign-up/email",
  "/change-password",
] as const;

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
        // BOTH flags, because they close different doors. `disableSignUp`
        // refuses to create a user for an unknown Google account outright;
        // `disableImplicitSignUp` refuses unless the sign-in was started with
        // `requestSignUp: true`, which this app never sends. Either alone
        // closes the route today; together, a future change that drops one
        // still leaves it closed.
        disableSignUp: true,
        disableImplicitSignUp: true,
      },
    }
  : {};

export const auth = betterAuth({
  // Falls back to `BETTER_AUTH_URL`, which on this app is its OWN origin.
  // `src/instrumentation.ts` refuses to start a production server without
  // it, so the origin is never derived from a request header in production.
  baseURL: process.env.BETTER_AUTH_URL,

  database: prismaAdapter(prisma, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    // See the module note: a self-served account can read every log line.
    disableSignUp: true,
  },

  socialProviders,

  disabledPaths: [...DISABLED_AUTH_PATHS],

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

    database: {
      // ONE QUERY PER SESSION LOOKUP instead of two. Better Auth's internal
      // adapter asks for `join: { user: true }` on every session read
      // (`better-auth/dist/db/internal-adapter.mjs`, `findSession`), but the
      // adapter factory forwards the join only when this flag is set and
      // otherwise fetches the user in a second round trip
      // (`@better-auth/core/dist/db/adapter/factory.mjs`, `passJoinToAdapter`
      // and `handleFallbackJoin`). The installed Prisma adapter honours the
      // join (`@better-auth/prisma-adapter/dist/index.mjs`, `findOne` and
      // `convertSelect`) as a nested `select` on the relation it derives from
      // the foreign key — `user` on `Session` and `Account`, `accounts` on
      // `User` — which are the relation names `prisma/schema.prisma` declares.
      joins: true,
    },
  },

  // MUST BE LAST: the plugin's after-hook is what copies Better Auth's
  // `Set-Cookie` onto the Next response for `auth.api.*` calls made from a
  // Server Action, and a plugin registered after it would not be covered.
  plugins: [nextCookies()],
});
