/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { browserAdapter } from "./browser-adapter";

describe("browserAdapter lifecycle", () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it("flushes urgently on pagehide, which is the last reliable signal", () => {
    const flush = vi.fn();
    dispose = browserAdapter.installLifecycle(flush);

    window.dispatchEvent(new Event("pagehide"));

    expect(flush).toHaveBeenCalledWith(true);
  });

  it("flushes when the document becomes hidden", () => {
    const flush = vi.fn();
    dispose = browserAdapter.installLifecycle(flush);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    document.dispatchEvent(new Event("visibilitychange"));

    expect(flush).toHaveBeenCalledWith(true);
  });

  it("does not flush while the document is still visible", () => {
    const flush = vi.fn();
    dispose = browserAdapter.installLifecycle(flush);

    document.dispatchEvent(new Event("visibilitychange"));

    expect(flush).not.toHaveBeenCalled();
  });

  it("removes its listeners when disposed", () => {
    const flush = vi.fn();
    browserAdapter.installLifecycle(flush)();

    window.dispatchEvent(new Event("pagehide"));

    expect(flush).not.toHaveBeenCalled();
  });
});
