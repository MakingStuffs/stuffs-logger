import { afterEach, describe, expect, it, vi } from "vitest";

import { auth, isGoogleConfigured } from "./auth";

/**
 * That the auth instance BUILDS at all, with nothing configured, and that the
 * doors it is meant to keep shut are shut.
 *
 * The boot check matters because the deployment story is "email and password
 * work immediately, Google is opt-in", and the way that story breaks is a
 * module that throws on import when `GOOGLE_CLIENT_ID` is absent. That
 * failure would take down every page at once and would not be caught by any
 * test that mocks this module — which every other test here does.
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

  it("takes the library's own password routes off the HTTP router", () => {
    // The sign-in form goes through `auth.api.signInEmail` from a Server
    // Action, which is where the app's throttle lives. The router would
    // otherwise still serve `/api/auth/sign-in/email` as a second, unthrottled
    // guessing endpoint — and `/sign-up/email` as a registration one.
    expect(auth.options.disabledPaths).toEqual(
      expect.arrayContaining([
        "/sign-in/email",
        "/sign-up/email",
        "/change-password",
      ]),
    );
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

  it("resolves a session with one database query, not two", () => {
    // Better Auth asks the adapter to join the user onto every session read,
    // but only forwards that join when this flag is set; otherwise it fetches
    // the user in a second round trip. The installed Prisma adapter honours
    // the join (see the comment on the option in `auth.ts`).
    expect(auth.options.advanced?.database?.joins).toBe(true);
  });
});

/**
 * Google is read from the environment at module load, so each case below
 * stubs the variables, drops the module registry and imports a fresh instance.
 */
describe("the auth instance with Google configured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadWith(env: {
    GOOGLE_CLIENT_ID: string | undefined;
    GOOGLE_CLIENT_SECRET: string | undefined;
  }): Promise<typeof import("./auth")> {
    vi.stubEnv("GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", env.GOOGLE_CLIENT_SECRET);
    vi.resetModules();

    return import("./auth");
  }

  it("closes sign-up on the Google route as well as the password route", async () => {
    // `emailAndPassword.disableSignUp` does not reach an OAuth callback: Better
    // Auth creates a user for an unknown Google account unless the PROVIDER
    // says not to. Without these two flags, anyone with a Google account would
    // get an active MEMBER session — and every log line — on first sign-in.
    const fresh = await loadWith({
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
    });

    expect(fresh.isGoogleConfigured()).toBe(true);
    expect(fresh.auth.options.socialProviders?.google?.disableSignUp).toBe(
      true,
    );
    expect(
      fresh.auth.options.socialProviders?.google?.disableImplicitSignUp,
    ).toBe(true);
  });

  it.each([
    [
      "the client id",
      { GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: "s" },
    ],
    [
      "the client secret",
      { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: undefined },
    ],
    ["an empty client id", { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "s" }],
  ])("registers no provider when %s is missing", async (_name, env) => {
    const fresh = await loadWith(env);

    expect(fresh.isGoogleConfigured()).toBe(false);
    expect(fresh.auth.options.socialProviders).toEqual({});
  });
});
