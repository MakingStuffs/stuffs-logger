import { describe, expect, it, vi } from "vitest";

import { auth, isGoogleConfigured } from "./auth";

/**
 * That the auth instance BUILDS at all, with nothing configured.
 *
 * This is a boot check, not a behaviour test: the deployment story is "email
 * and password work immediately, Google is opt-in", and the way that story
 * breaks is a module that throws on import when `GOOGLE_CLIENT_ID` is absent.
 * That failure would take down every page at once and would not be caught by
 * any test that mocks this module — which every other test here does.
 *
 * The Prisma client is stubbed so nothing tries to reach a database; the
 * adapter is constructed with it either way, which is the part being proved.
 */
vi.mock("@/lib/db", () => ({ prisma: {} }));

describe("the auth instance", () => {
  it("builds with no external credentials configured", () => {
    expect(auth.handler).toBeTypeOf("function");
  });

  it("exposes the session and sign-out endpoints the facade calls", () => {
    expect(auth.api.getSession).toBeTypeOf("function");
    expect(auth.api.signOut).toBeTypeOf("function");
    expect(auth.api.signInEmail).toBeTypeOf("function");
    expect(auth.api.signInSocial).toBeTypeOf("function");
  });

  it("keeps email and password available", () => {
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
  });

  it("closes self-service sign-up", () => {
    // A MEMBER reads every application's logs, so an open registration form
    // would publish them. Accounts are provisioned, not self-served.
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
  });

  it("refuses to take role or activity from a request body", () => {
    const fields = auth.options.user?.additionalFields;

    expect(fields?.role?.input).toBe(false);
    expect(fields?.role?.defaultValue).toBe("MEMBER");
    expect(fields?.isActive?.input).toBe(false);
  });

  it("registers no social provider when Google is not configured", () => {
    expect(isGoogleConfigured()).toBe(false);
    expect(auth.options.socialProviders).toEqual({});
  });
});
