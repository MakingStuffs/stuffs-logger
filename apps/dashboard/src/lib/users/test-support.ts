import type { AppSession, AppUser } from "@/lib/auth/types";

/**
 * Test factories shared by the `lib/users` suites.
 *
 * Not a `.test.ts` file, so Vitest does not collect it, and imported only by
 * tests — no application module depends on it.
 */

/** A resolved session for a live user; ADMIN unless overridden. */
export function makeSession(overrides: Partial<AppUser> = {}): AppSession {
  const id = overrides.id ?? "admin-1";

  return {
    user: {
      id,
      email: "admin@makingstuffs.test",
      name: "An Admin",
      role: "ADMIN",
      image: null,
      isActive: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    },
    session: {
      id: "session-1",
      token: "session-token",
      userId: id,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ipAddress: null,
      userAgent: null,
    },
  };
}

/** Builds a `FormData` from plain entries, as a form submission would. */
export function formOf(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

/**
 * Every key anywhere in a value, recursively — for asserting that a Prisma
 * selector never names a credential column at any depth.
 */
export function deepKeys(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];

  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...deepKeys(nested),
  ]);
}

/** Column names that hold a credential or a token. Never selectable. */
export const SECRET_COLUMNS = [
  "password",
  "accessToken",
  "refreshToken",
  "idToken",
  "token",
] as const;
