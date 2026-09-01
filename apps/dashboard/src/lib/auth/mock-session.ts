import type { AppSession } from "./types";

/**
 * The session served when `SKIP_AUTH` is on.
 *
 * An ACTIVE ADMIN, so every gated surface renders locally exactly as it would
 * for a real administrator — which is the entire point of the bypass. It is
 * reachable only through `isAuthSkipped()`, and a production build refuses to
 * boot with that flag set (see `constants/environment.ts`).
 */
export const MOCK_SESSION: AppSession = {
  user: {
    id: "skip-auth-user",
    email: "dev@localhost",
    name: "Dev User",
    role: "ADMIN",
    image: null,
    isActive: true,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  },
  session: {
    id: "skip-auth-session",
    token: "skip-auth-token",
    userId: "skip-auth-user",
    // Far future, so nothing in the app has to special-case the mock's expiry.
    expiresAt: new Date("2099-12-31T23:59:59.999Z"),
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    ipAddress: null,
    userAgent: null,
  },
};
