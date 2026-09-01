/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_SHORT_FIELD_LENGTH, MAX_URL_LENGTH } from "../contract";
import { SESSION_STORAGE_KEY } from "../defaults";
import { createBrowserContextCollector } from "./browser";
import { resolveSessionId } from "./session";

describe("createBrowserContextCollector", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the current url, user agent and viewport", () => {
    const collected = createBrowserContextCollector(undefined).collect();

    expect(collected.url).toBe(window.location.href);
    expect(collected.userAgent).toBe(window.navigator.userAgent);
    expect(collected.context).toEqual({
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    });
  });

  it("does not report a device class, which the server derives instead", () => {
    const collected = createBrowserContextCollector(undefined).collect();

    expect(collected.context).not.toHaveProperty("deviceType");
  });

  it("resamples the url so a single-page navigation is attributed correctly", () => {
    const collector = createBrowserContextCollector(undefined);
    const first = collector.collect().url;

    window.history.pushState({}, "", "/checkout/payment");

    expect(collector.collect().url).not.toBe(first);
    expect(collector.collect().url).toContain("/checkout/payment");
  });

  it("bounds a very long url", () => {
    vi.stubGlobal("location", {
      href: `https://example.com/${"a".repeat(5000)}`,
    });

    const url = createBrowserContextCollector(undefined).collect().url ?? "";

    expect(url.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
  });

  it("prefers a session id supplied by the application", () => {
    expect(createBrowserContextCollector("app-session").sessionId()).toBe(
      "app-session",
    );
  });

  it("resolves the persisted session id only once", () => {
    const collector = createBrowserContextCollector(undefined);

    const first = collector.sessionId();
    window.sessionStorage.clear();

    expect(collector.sessionId()).toBe(first);
  });
});

describe("resolveSessionId", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists the id so a reload stays one session", () => {
    const first = resolveSessionId();

    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(first);
    expect(resolveSessionId()).toBe(first);
  });

  it("stays within the contract's short-field limit", () => {
    expect(resolveSessionId().length).toBeLessThanOrEqual(
      MAX_SHORT_FIELD_LENGTH,
    );
  });

  it("still produces an id when storage is blocked", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked in a sandboxed frame");
      },
      setItem: () => {
        throw new Error("blocked in a sandboxed frame");
      },
    });

    expect(resolveSessionId().length).toBeGreaterThan(0);
  });
});
