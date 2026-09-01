import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  hashIngestSecret,
  isOriginAllowed,
  keyClassAllowsSource,
  verifyIngestKey,
  type IngestKeyRecord,
  type IngestKeyStore,
} from "./keys";

const PUBLIC_KEY = `slg_pub_${"p".repeat(32)}`;
const SECRET_KEY_ID = "lookuphandle1234";
const SECRET_SEGMENT = "s".repeat(43);
const SECRET_KEY = `slg_sec_${SECRET_KEY_ID}_${SECRET_SEGMENT}`;

const ALLOWED_ORIGIN = "https://app.example.test";

function makeKey(overrides: Partial<IngestKeyRecord> = {}): IngestKeyRecord {
  return {
    id: "key-1",
    applicationId: "app-1",
    type: "PUBLIC",
    publicKey: PUBLIC_KEY,
    keyId: null,
    secretHash: null,
    allowedOrigins: [ALLOWED_ORIGIN],
    revokedAt: null,
    ...overrides,
  };
}

function makeSecretKey(
  overrides: Partial<IngestKeyRecord> = {},
): IngestKeyRecord {
  return makeKey({
    id: "key-2",
    type: "SECRET",
    publicKey: null,
    keyId: SECRET_KEY_ID,
    secretHash: createHash("sha256").update(SECRET_SEGMENT).digest("hex"),
    allowedOrigins: [],
    ...overrides,
  });
}

/** A store holding zero or more keys, matched the way the real one queries. */
function makeStore(keys: IngestKeyRecord[]): IngestKeyStore {
  return {
    findPublicKey: async (key) =>
      keys.find((row) => row.type === "PUBLIC" && row.publicKey === key) ??
      null,
    findSecretKeyByKeyId: async (keyId) =>
      keys.find((row) => row.type === "SECRET" && row.keyId === keyId) ?? null,
  };
}

describe("hashIngestSecret", () => {
  it("produces the SHA-256 hex digest of the secret segment", () => {
    expect(hashIngestSecret(SECRET_SEGMENT)).toBe(
      createHash("sha256").update(SECRET_SEGMENT).digest("hex"),
    );
  });
});

describe("verifyIngestKey", () => {
  describe("public keys", () => {
    it("accepts a live key presented from an allowed origin", async () => {
      const result = await verifyIngestKey(PUBLIC_KEY, {
        origin: ALLOWED_ORIGIN,
        store: makeStore([makeKey()]),
      });

      expect(result).toEqual({
        ok: true,
        key: {
          id: "key-1",
          applicationId: "app-1",
          type: "PUBLIC",
          matchedOrigin: ALLOWED_ORIGIN,
        },
      });
    });

    it("refuses a key presented from an origin that is not on its list", async () => {
      const result = await verifyIngestKey(PUBLIC_KEY, {
        origin: "https://evil.test",
        store: makeStore([makeKey()]),
      });

      expect(result).toEqual({ ok: false, reason: "origin_not_allowed" });
    });

    it("refuses a key presented with no Origin header at all", async () => {
      const result = await verifyIngestKey(PUBLIC_KEY, {
        origin: null,
        store: makeStore([makeKey()]),
      });

      expect(result).toEqual({ ok: false, reason: "origin_not_allowed" });
    });

    it("matches origins exactly, never by prefix or suffix", async () => {
      const store = makeStore([makeKey()]);

      const suffix = await verifyIngestKey(PUBLIC_KEY, {
        origin: "https://evil-app.example.test",
        store,
      });
      const subdomain = await verifyIngestKey(PUBLIC_KEY, {
        origin: "https://app.example.test.evil.test",
        store,
      });
      const scheme = await verifyIngestKey(PUBLIC_KEY, {
        origin: "http://app.example.test",
        store,
      });
      const port = await verifyIngestKey(PUBLIC_KEY, {
        origin: "https://app.example.test:8443",
        store,
      });

      for (const result of [suffix, subdomain, scheme, port]) {
        expect(result).toEqual({ ok: false, reason: "origin_not_allowed" });
      }
    });

    it("refuses a revoked key before it ever considers the origin", async () => {
      const revoked = makeKey({ revokedAt: new Date("2026-01-01T00:00:00Z") });

      const result = await verifyIngestKey(PUBLIC_KEY, {
        origin: ALLOWED_ORIGIN,
        store: makeStore([revoked]),
      });

      expect(result).toEqual({ ok: false, reason: "invalid_key" });
    });

    it("refuses a key with an empty origin allowlist", async () => {
      const result = await verifyIngestKey(PUBLIC_KEY, {
        origin: ALLOWED_ORIGIN,
        store: makeStore([makeKey({ allowedOrigins: [] })]),
      });

      expect(result).toEqual({ ok: false, reason: "origin_not_allowed" });
    });

    it("refuses an unknown key", async () => {
      const result = await verifyIngestKey(`slg_pub_${"z".repeat(32)}`, {
        origin: ALLOWED_ORIGIN,
        store: makeStore([makeKey()]),
      });

      expect(result).toEqual({ ok: false, reason: "invalid_key" });
    });
  });

  describe("secret keys", () => {
    it("accepts a live key with a matching secret and no origin", async () => {
      const result = await verifyIngestKey(SECRET_KEY, {
        origin: null,
        store: makeStore([makeSecretKey()]),
      });

      expect(result).toEqual({
        ok: true,
        key: {
          id: "key-2",
          applicationId: "app-1",
          type: "SECRET",
          matchedOrigin: null,
        },
      });
    });

    it("accepts a live key regardless of the origin presented", async () => {
      const result = await verifyIngestKey(SECRET_KEY, {
        origin: "https://anywhere.test",
        store: makeStore([makeSecretKey()]),
      });

      expect(result.ok).toBe(true);
    });

    it("refuses a key whose secret does not match the stored hash", async () => {
      const wrongSecret = `slg_sec_${SECRET_KEY_ID}_${"x".repeat(43)}`;

      const result = await verifyIngestKey(wrongSecret, {
        origin: null,
        store: makeStore([makeSecretKey()]),
      });

      expect(result).toEqual({ ok: false, reason: "invalid_key" });
    });

    it("refuses a revoked key even with the correct secret", async () => {
      const revoked = makeSecretKey({
        revokedAt: new Date("2026-01-01T00:00:00Z"),
      });

      const result = await verifyIngestKey(SECRET_KEY, {
        origin: null,
        store: makeStore([revoked]),
      });

      expect(result).toEqual({ ok: false, reason: "invalid_key" });
    });

    it("refuses an unknown lookup handle", async () => {
      const result = await verifyIngestKey(
        `slg_sec_otherhandle999_${SECRET_SEGMENT}`,
        {
          origin: null,
          store: makeStore([makeSecretKey()]),
        },
      );

      expect(result).toEqual({ ok: false, reason: "invalid_key" });
    });

    it("refuses a key row with no stored hash", async () => {
      const result = await verifyIngestKey(SECRET_KEY, {
        origin: null,
        store: makeStore([makeSecretKey({ secretHash: null })]),
      });

      expect(result).toEqual({ ok: false, reason: "invalid_key" });
    });

    it("refuses a key row with a malformed stored hash", async () => {
      const result = await verifyIngestKey(SECRET_KEY, {
        origin: null,
        store: makeStore([makeSecretKey({ secretHash: "not-a-digest" })]),
      });

      expect(result).toEqual({ ok: false, reason: "invalid_key" });
    });
  });

  describe("cross-type confusion", () => {
    it("refuses a public key value that resolves to a SECRET row", async () => {
      const mislabelled = makeSecretKey({ publicKey: PUBLIC_KEY, keyId: null });

      const result = await verifyIngestKey(PUBLIC_KEY, {
        origin: ALLOWED_ORIGIN,
        store: makeStore([mislabelled]),
      });

      expect(result).toEqual({ ok: false, reason: "invalid_key" });
    });

    it("refuses a secret-shaped key that resolves to a PUBLIC row", async () => {
      const mislabelled = makeKey({ keyId: SECRET_KEY_ID, type: "PUBLIC" });
      const store: IngestKeyStore = {
        findPublicKey: async () => null,
        findSecretKeyByKeyId: async () => mislabelled,
      };

      const result = await verifyIngestKey(SECRET_KEY, { origin: null, store });

      expect(result).toEqual({ ok: false, reason: "invalid_key" });
    });
  });

  describe("malformed credentials", () => {
    it.each([
      ["a missing header", null],
      ["an empty string", ""],
      ["an unknown prefix", `slg_adm_${"a".repeat(32)}`],
      ["a bare random string", "a".repeat(32)],
      ["a public prefix with no random segment", "slg_pub_"],
      ["a secret key with no secret segment", `slg_sec_${SECRET_KEY_ID}`],
      ["a secret key with an empty secret", `slg_sec_${SECRET_KEY_ID}_`],
      ["an absurdly long value", `slg_pub_${"a".repeat(5000)}`],
    ])("refuses %s", async (_label, presented) => {
      const result = await verifyIngestKey(presented, {
        origin: ALLOWED_ORIGIN,
        store: makeStore([makeKey(), makeSecretKey()]),
      });

      expect(result).toEqual({ ok: false, reason: "invalid_key" });
    });

    it("never touches the store for a malformed key", async () => {
      let queries = 0;
      const store: IngestKeyStore = {
        findPublicKey: async () => {
          queries += 1;
          return null;
        },
        findSecretKeyByKeyId: async () => {
          queries += 1;
          return null;
        },
      };

      await verifyIngestKey("garbage", { origin: null, store });

      expect(queries).toBe(0);
    });
  });
});

describe("isOriginAllowed", () => {
  const allowed = [ALLOWED_ORIGIN, "https://other.example.test"];

  it("accepts an exact match", () => {
    expect(isOriginAllowed(ALLOWED_ORIGIN, allowed)).toBe(true);
  });

  it("refuses a missing origin", () => {
    expect(isOriginAllowed(null, allowed)).toBe(false);
  });

  it("refuses an empty allowlist", () => {
    expect(isOriginAllowed(ALLOWED_ORIGIN, [])).toBe(false);
  });

  it.each([
    ["a suffix attack", "https://app.example.test.evil.test"],
    ["a prefix attack", "https://evil-app.example.test"],
    ["a scheme downgrade", "http://app.example.test"],
    ["an added port", "https://app.example.test:8443"],
    ["a trailing slash", "https://app.example.test/"],
    ["a case change", "https://APP.example.test"],
    ["a subdomain", "https://sub.app.example.test"],
  ])("refuses %s", (_label, origin) => {
    expect(isOriginAllowed(origin, allowed)).toBe(false);
  });

  it("refuses the null origin string sent by sandboxed frames", () => {
    expect(isOriginAllowed("null", allowed)).toBe(false);
  });
});

describe("keyClassAllowsSource", () => {
  it("allows a secret key to authenticate a node batch", () => {
    expect(keyClassAllowsSource("SECRET", "node")).toBe(true);
  });

  it("allows a secret key to authenticate a browser batch", () => {
    expect(keyClassAllowsSource("SECRET", "browser")).toBe(true);
  });

  it("allows a public key to authenticate a browser batch", () => {
    expect(keyClassAllowsSource("PUBLIC", "browser")).toBe(true);
  });

  it("REFUSES a public key for a node batch", () => {
    // The control that keeps the origin allowlist meaningful: a server-side
    // caller can set any Origin it likes, so a public key must not be usable
    // from one.
    expect(keyClassAllowsSource("PUBLIC", "node")).toBe(false);
  });
});
