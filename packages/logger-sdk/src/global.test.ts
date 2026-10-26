import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeTransport, PUBLIC_KEY } from "./testing/fixtures";

/**
 * The IIFE build is loaded by whatever a page happens to be — including hosts
 * with no DOM at all, such as a worker or a server-side HTML renderer. It must
 * finish loading there, because failing to would take the page's script
 * execution down with it.
 */
describe("the global build in a host with no document", () => {
  it("loads without throwing", async () => {
    await expect(import("./global")).resolves.toBeDefined();
  });

  it("leaves the level shortcuts callable and inert before init", async () => {
    const global = await import("./global");

    expect(global.getLogger()).toBeUndefined();
    expect(() => {
      global.info("nobody is listening");
      global.error("still nobody");
    }).not.toThrow();
  });

  it("resolves flush even when it was never initialized", async () => {
    const global = await import("./global");

    await expect(global.flush()).resolves.toBeUndefined();
  });
});

describe("init called more than once", () => {
  const quiet = {
    transport: createFakeTransport(),
    autoContext: false,
    captureConsole: false,
    captureErrors: false,
  };

  beforeEach(() => {
    vi.resetModules();
  });

  it("keeps the first configuration and tells the second caller so", async () => {
    const { init } = await import("./global");
    const onError = vi.fn();

    const first = init({ ...quiet, apiKey: PUBLIC_KEY });
    const second = init({ ...quiet, apiKey: `${PUBLIC_KEY}2`, onError });

    expect(second).toBe(first);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "logger.config");
  });

  it("notices a different endpoint as well as a different key", async () => {
    const { init } = await import("./global");
    const onError = vi.fn();

    init({ ...quiet, apiKey: PUBLIC_KEY, endpoint: "https://a.example.com" });
    init({
      ...quiet,
      apiKey: PUBLIC_KEY,
      endpoint: "https://b.example.com",
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the second call repeats the first configuration", async () => {
    const { init } = await import("./global");
    const onError = vi.fn();

    init({ ...quiet, apiKey: PUBLIC_KEY });
    init({ ...quiet, apiKey: PUBLIC_KEY, onError });

    expect(onError).not.toHaveBeenCalled();
  });
});
