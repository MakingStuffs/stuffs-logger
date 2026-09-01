import { describe, expect, it } from "vitest";

import { parseIngestKey } from "./keys";

const VALID_RANDOM = "a".repeat(32);
const VALID_KEY_ID = "abc12345def67890";

describe("parseIngestKey", () => {
  it("parses a public key", () => {
    const parsed = parseIngestKey(`jfl_pub_${VALID_RANDOM}`);

    expect(parsed).toEqual({ kind: "public", key: `jfl_pub_${VALID_RANDOM}` });
  });

  it("parses a secret key into its lookup handle and secret", () => {
    const parsed = parseIngestKey(`jfl_sec_${VALID_KEY_ID}_${VALID_RANDOM}`);

    expect(parsed).toEqual({
      kind: "secret",
      keyId: VALID_KEY_ID,
      secret: VALID_RANDOM,
    });
  });

  it("keeps underscores in the secret segment with the secret, not the handle", () => {
    const secret = `${"b".repeat(16)}_${"c".repeat(16)}`;
    const parsed = parseIngestKey(`jfl_sec_${VALID_KEY_ID}_${secret}`);

    expect(parsed).toEqual({ kind: "secret", keyId: VALID_KEY_ID, secret });
  });

  it("rejects an unknown prefix", () => {
    expect(parseIngestKey(`jfl_adm_${VALID_RANDOM}`)).toBeNull();
    expect(parseIngestKey(VALID_RANDOM)).toBeNull();
  });

  it("rejects an empty value", () => {
    expect(parseIngestKey("")).toBeNull();
  });

  it("rejects a public key with too short a random segment", () => {
    expect(parseIngestKey("jfl_pub_short")).toBeNull();
  });

  it("rejects an over-long value before inspecting it", () => {
    expect(parseIngestKey(`jfl_pub_${"a".repeat(500)}`)).toBeNull();
  });

  it("rejects characters outside the base64url alphabet", () => {
    expect(parseIngestKey(`jfl_pub_${"a".repeat(31)}$`)).toBeNull();
    expect(parseIngestKey(`jfl_pub_${"a".repeat(31)}'`)).toBeNull();
  });

  it("rejects a secret key with no secret segment", () => {
    expect(parseIngestKey(`jfl_sec_${VALID_KEY_ID}`)).toBeNull();
  });

  it("rejects a secret key with an empty secret segment", () => {
    expect(parseIngestKey(`jfl_sec_${VALID_KEY_ID}_`)).toBeNull();
  });

  it("rejects a secret key with too short a lookup handle", () => {
    expect(parseIngestKey(`jfl_sec_abc_${VALID_RANDOM}`)).toBeNull();
  });
});
