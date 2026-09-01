import { describe, expect, it } from "vitest";

import {
  DEFAULT_REDACTION_KEYS as CORE_REDACTION_KEYS,
  DEFAULT_REDACTION_REPLACEMENT,
} from "@stuffs-logger/core/redaction";

import { DEFAULT_REDACTION_KEYS } from "../public-api";
import { createRedactor } from "./redact";

describe("createRedactor", () => {
  it("redacts secret-shaped keys whatever the casing convention", () => {
    const redactor = createRedactor(undefined);

    for (const key of [
      "password",
      "PASSWORD",
      "userPassword",
      "api_key",
      "X-Api-Key",
      "apiKey",
      "Authorization",
      "set-cookie",
      "sessionToken",
      "refresh_token",
      "privateKey",
    ]) {
      expect(redactor?.shouldRedact(key), key).toBe(true);
    }
  });

  it("leaves ordinary keys alone", () => {
    const redactor = createRedactor(undefined);

    for (const key of ["userId", "basketId", "durationMs", "path", "status"]) {
      expect(redactor?.shouldRedact(key), key).toBe(false);
    }
  });

  it("returns no redactor when redaction is switched off", () => {
    expect(createRedactor({ enabled: false })).toBeUndefined();
  });

  it("replaces the built-in list when keys are supplied", () => {
    const redactor = createRedactor({ keys: ["ticket"] });

    expect(redactor?.shouldRedact("ticket")).toBe(true);
    expect(redactor?.shouldRedact("password")).toBe(false);
  });

  it("extends the built-in list when additionalKeys are supplied", () => {
    const redactor = createRedactor({ additionalKeys: ["ticket"] });

    expect(redactor?.shouldRedact("ticket")).toBe(true);
    expect(redactor?.shouldRedact("password")).toBe(true);
  });

  it("matches regular-expression patterns against the raw key", () => {
    const redactor = createRedactor({ keys: [/^x-internal-/i] });

    expect(redactor?.shouldRedact("X-Internal-Trace")).toBe(true);
    expect(redactor?.shouldRedact("trace")).toBe(false);
  });

  it("uses the configured replacement", () => {
    expect(createRedactor({ replacement: "***" })?.replacement).toBe("***");
  });

  it("defaults to the replacement the server also uses", () => {
    expect(createRedactor(undefined)?.replacement).toBe(
      DEFAULT_REDACTION_REPLACEMENT,
    );
  });

  it("publishes the core's key list rather than a copy of it", () => {
    // The whole point of the shared control: a key added in the core is
    // redacted by the client too, with no second list to remember to update.
    expect(DEFAULT_REDACTION_KEYS).toBe(CORE_REDACTION_KEYS);
  });

  it("redacts every key the shared list names", () => {
    const redactor = createRedactor(undefined);

    for (const key of CORE_REDACTION_KEYS) {
      expect(redactor?.shouldRedact(key), key).toBe(true);
    }
  });
});
