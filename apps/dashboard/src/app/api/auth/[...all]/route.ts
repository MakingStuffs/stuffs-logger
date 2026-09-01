import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth";

/**
 * `/api/auth/*` — Better Auth's own endpoints.
 *
 * AUTH TIER: PUBLIC by definition. This is where a caller GETS a session, so
 * it cannot require one; Better Auth validates every credential, applies its
 * own rate limiting and CSRF checks, and owns the cookie. Nothing is added
 * here — a hand-written wrapper around an auth handler is a second, weaker
 * implementation of the checks the library already makes.
 *
 * Reachable at `/api/auth/sign-in/email`, `/api/auth/callback/google`,
 * `/api/auth/get-session`, `/api/auth/sign-out` and the rest of the surface.
 * The OAuth provider's redirect_uri points at the callback path here.
 *
 * The CSP proxy deliberately does not run on `/api/*` (see `src/proxy.ts`),
 * which is right: there is no document and no script to police.
 */

/** Node runtime: this talks to Postgres and uses `node:crypto`. */
export const runtime = "nodejs";

/** Never cached — every response depends on the request's own cookies. */
export const dynamic = "force-dynamic";

export const { GET, POST } = toNextJsHandler(auth.handler);
