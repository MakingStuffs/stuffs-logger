import { describe, expect, it } from "vitest";

import { isActiveHref } from "./active-href";

describe("isActiveHref", () => {
  it("marks the entry whose destination is the page on screen", () => {
    expect(isActiveHref("/logs", "/logs")).toBe(true);
  });

  it("keeps a section marked while the reader is inside it", () => {
    expect(isActiveHref("/logs/abc123", "/logs")).toBe(true);
  });

  it("does not mark a sibling whose path merely starts the same way", () => {
    expect(isActiveHref("/apps-legacy", "/apps")).toBe(false);
  });

  it("marks the overview only on the overview itself", () => {
    expect(isActiveHref("/", "/")).toBe(true);
  });

  it("does not let the overview claim every page below it", () => {
    expect(isActiveHref("/logs", "/")).toBe(false);
  });

  it("does not mark an unrelated section", () => {
    expect(isActiveHref("/apps", "/logs")).toBe(false);
  });
});
