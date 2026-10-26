import { describe, expect, it } from "vitest";

import { toSignInMethods } from "./sign-in-methods";

describe("toSignInMethods", () => {
  it("reports a password-only user", () => {
    expect(toSignInMethods(["credential"])).toEqual({
      password: true,
      google: false,
      other: [],
    });
  });

  it("reports a Google-only user, the shape of an unprovisioned sign-up", () => {
    expect(toSignInMethods(["google"])).toEqual({
      password: false,
      google: true,
      other: [],
    });
  });

  it("reports both when both are linked", () => {
    expect(toSignInMethods(["google", "credential"])).toEqual({
      password: true,
      google: true,
      other: [],
    });
  });

  it("reports nothing for a user who cannot sign in at all", () => {
    expect(toSignInMethods([])).toEqual({
      password: false,
      google: false,
      other: [],
    });
  });

  it("surfaces an unexpected provider rather than dropping it", () => {
    expect(toSignInMethods(["github", "credential", "github"]).other).toEqual([
      "github",
    ]);
  });
});
