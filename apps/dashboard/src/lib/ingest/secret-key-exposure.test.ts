import { beforeEach, describe, expect, it } from "vitest";

import {
  isSecretKeyExposedToBrowser,
  resetSecretKeyExposureWarnings,
  SECRET_EXPOSURE_WARN_THROTTLE_MS,
  shouldWarnSecretKeyExposure,
} from "./secret-key-exposure";

const NOW = 1_756_728_000_000;
const ORIGIN = "https://app.example.test";

describe("isSecretKeyExposedToBrowser", () => {
  it("flags a secret key sent with an Origin from a browser source", () => {
    expect(isSecretKeyExposedToBrowser("SECRET", ORIGIN, "browser")).toBe(true);
  });

  it("does not flag a secret key used from a server process", () => {
    expect(isSecretKeyExposedToBrowser("SECRET", null, "node")).toBe(false);
  });

  it("does not flag a secret key with an Origin but a node source", () => {
    expect(isSecretKeyExposedToBrowser("SECRET", ORIGIN, "node")).toBe(false);
  });

  it("does not flag a secret key with a browser source but no Origin", () => {
    expect(isSecretKeyExposedToBrowser("SECRET", null, "browser")).toBe(false);
  });

  it("never flags a public key, which belongs in a browser", () => {
    expect(isSecretKeyExposedToBrowser("PUBLIC", ORIGIN, "browser")).toBe(
      false,
    );
  });
});

describe("shouldWarnSecretKeyExposure", () => {
  beforeEach(() => {
    resetSecretKeyExposureWarnings();
  });

  it("warns the first time a key is seen", () => {
    expect(shouldWarnSecretKeyExposure("key-1", NOW)).toBe(true);
  });

  it("does not warn again within the throttle window", () => {
    shouldWarnSecretKeyExposure("key-1", NOW);

    expect(shouldWarnSecretKeyExposure("key-1", NOW + 1)).toBe(false);
    expect(
      shouldWarnSecretKeyExposure(
        "key-1",
        NOW + SECRET_EXPOSURE_WARN_THROTTLE_MS - 1,
      ),
    ).toBe(false);
  });

  it("warns again once the window has passed", () => {
    shouldWarnSecretKeyExposure("key-1", NOW);

    expect(
      shouldWarnSecretKeyExposure(
        "key-1",
        NOW + SECRET_EXPOSURE_WARN_THROTTLE_MS,
      ),
    ).toBe(true);
  });

  it("throttles each key independently", () => {
    shouldWarnSecretKeyExposure("key-1", NOW);

    expect(shouldWarnSecretKeyExposure("key-2", NOW)).toBe(true);
  });

  it("collapses a burst into a single warning", () => {
    const warnings = Array.from({ length: 500 }, (_, index) =>
      shouldWarnSecretKeyExposure("key-1", NOW + index),
    ).filter(Boolean);

    expect(warnings).toHaveLength(1);
  });
});
