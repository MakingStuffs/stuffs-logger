import { afterEach, describe, expect, it, vi } from "vitest";

import { MIN_BETTER_AUTH_SECRET_LENGTH } from "@/constants/environment";

/**
 * The server-start hook, proved at the one thing it decides: whether a
 * production server with an implicit auth origin is allowed to come up.
 *
 * Every case stubs the environment and imports a fresh module, because the
 * hook reads `process.env` and the module registry would otherwise hand back
 * the instance a previous case loaded.
 */
describe("register", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadRegister(env: Record<string, string | undefined>) {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    vi.resetModules();

    const { register } = await import("./instrumentation");

    return register;
  }

  const COMPLETE = {
    NEXT_RUNTIME: "nodejs",
    NODE_ENV: "production",
    BETTER_AUTH_URL: "https://logger.example.com",
    BETTER_AUTH_SECRET: "s".repeat(MIN_BETTER_AUTH_SECRET_LENGTH),
  };

  it("lets a production server start with a complete auth environment", async () => {
    const register = await loadRegister(COMPLETE);

    await expect(register()).resolves.toBeUndefined();
  });

  it("warns, but still starts, when a production server trusts no proxy", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const register = await loadRegister({
      ...COMPLETE,
      TRUSTED_PROXY_HOPS: undefined,
      VERCEL: undefined,
    });

    await expect(register()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("TRUSTED_PROXY_HOPS is not set"),
    );
    warn.mockRestore();
  });

  it("starts quietly when a proxy is trusted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const register = await loadRegister({
      ...COMPLETE,
      TRUSTED_PROXY_HOPS: "1",
    });

    await register();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("refuses to start a production server without BETTER_AUTH_URL", async () => {
    const register = await loadRegister({
      ...COMPLETE,
      BETTER_AUTH_URL: undefined,
    });

    await expect(register()).rejects.toThrow(/BETTER_AUTH_URL must be set/);
  });

  it("refuses to start a production server with a short BETTER_AUTH_SECRET", async () => {
    const register = await loadRegister({
      ...COMPLETE,
      BETTER_AUTH_SECRET: "short",
    });

    await expect(register()).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });

  it("lets a development server start with nothing configured", async () => {
    const register = await loadRegister({
      NEXT_RUNTIME: "nodejs",
      NODE_ENV: "development",
      BETTER_AUTH_URL: undefined,
      BETTER_AUTH_SECRET: undefined,
    });

    await expect(register()).resolves.toBeUndefined();
  });

  it("does nothing on a runtime other than Node", async () => {
    // Next calls `register` for every runtime it compiled. An Edge bundle has
    // no server to refuse to start, and nothing of ours runs there.
    const register = await loadRegister({
      ...COMPLETE,
      NEXT_RUNTIME: "edge",
      BETTER_AUTH_URL: undefined,
    });

    await expect(register()).resolves.toBeUndefined();
  });
});
