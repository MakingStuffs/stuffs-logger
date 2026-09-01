import { describe, expect, it } from "vitest";

import { PUBLIC_KEY, SECRET_KEY } from "../testing/fixtures";
import { checkCredential } from "./credentials";

describe("checkCredential", () => {
  it("accepts a public key in the browser", () => {
    expect(checkCredential(PUBLIC_KEY, "browser")).toEqual({
      ok: true,
      apiKey: PUBLIC_KEY,
    });
  });

  it("accepts a secret key in Node", () => {
    expect(checkCredential(SECRET_KEY, "node")).toEqual({
      ok: true,
      apiKey: SECRET_KEY,
    });
  });

  it("refuses a secret key in the browser", () => {
    const result = checkCredential(SECRET_KEY, "browser");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/never be shipped/);
  });

  it("refuses a public key in Node", () => {
    const result = checkCredential(PUBLIC_KEY, "node");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/browser-only/);
  });

  it("refuses a malformed key", () => {
    expect(checkCredential("not-a-key", "node").ok).toBe(false);
    expect(checkCredential("slg_pub_short", "browser").ok).toBe(false);
  });

  it("refuses a missing key", () => {
    expect(checkCredential(undefined, "browser").ok).toBe(false);
    expect(checkCredential("", "browser").ok).toBe(false);
  });
});
