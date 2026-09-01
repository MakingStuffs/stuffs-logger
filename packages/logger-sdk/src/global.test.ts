import { describe, expect, it } from "vitest";

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

  it("resolves flush even when it was never initialised", async () => {
    const global = await import("./global");

    await expect(global.flush()).resolves.toBeUndefined();
  });
});
