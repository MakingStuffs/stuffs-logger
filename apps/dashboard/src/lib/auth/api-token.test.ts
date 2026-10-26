import { beforeEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "@/lib/crypto/digest";
import { prisma } from "@/lib/db";

import { generateApiToken, hashApiToken, verifyApiToken } from "./api-token";

/**
 * The machine-caller credential, proved from the outside.
 *
 * Only the database is mocked. The decision itself — hashing, the constant-time
 * comparison, the revocation check and the atomic claim — runs for real,
 * because those are the things worth holding. Every denial asserts that no
 * claim was written: a refused caller that still stamps `lastUsedAt` could
 * push the window forward forever and starve the legitimate cron run.
 */
vi.mock("@/lib/db", () => ({
  prisma: {
    apiToken: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));

const RAW_TOKEN = "slg_cron_9f2a1c4e7b8d3f6a0c5e2b9d4f7a1c8e";
const TOKEN_HASH = sha256Hex(RAW_TOKEN);
const ONE_HOUR_MS = 60 * 60 * 1000;

interface TokenRow {
  id: string;
  name: string;
  tokenHash: string;
  revokedAt: Date | null;
}

function makeRow(overrides: Partial<TokenRow> = {}): TokenRow {
  return {
    id: "token-1",
    name: "Retention cron",
    tokenHash: TOKEN_HASH,
    revokedAt: null,
    ...overrides,
  };
}

function tokenExists(row: TokenRow | null): void {
  vi.mocked(prisma.apiToken.findUnique).mockResolvedValue(row as never);
}

function claimSucceeds(count: number): void {
  vi.mocked(prisma.apiToken.updateMany).mockResolvedValue({ count } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenExists(makeRow());
  claimSucceeds(1);
});

describe("hashApiToken", () => {
  it("stores a digest, never the token", () => {
    expect(hashApiToken(RAW_TOKEN)).toBe(TOKEN_HASH);
    expect(hashApiToken(RAW_TOKEN)).not.toContain(RAW_TOKEN);
  });

  it("is the same function the ingest keys use", () => {
    expect(hashApiToken(RAW_TOKEN)).toBe(sha256Hex(RAW_TOKEN));
  });
});

describe("verifyApiToken", () => {
  it("accepts a live token and claims the run", async () => {
    const result = await verifyApiToken(RAW_TOKEN);

    expect(result).toEqual({
      ok: true,
      token: { tokenId: "token-1", name: "Retention cron" },
    });
    expect(prisma.apiToken.updateMany).toHaveBeenCalledTimes(1);
  });

  it("looks the token up by its digest, never by its plaintext", async () => {
    await verifyApiToken(RAW_TOKEN);

    const call = vi.mocked(prisma.apiToken.findUnique).mock.calls[0]?.[0];

    expect(JSON.stringify(call)).toContain(TOKEN_HASH);
    expect(JSON.stringify(call)).not.toContain(RAW_TOKEN);
  });

  it("refuses an unknown token", async () => {
    tokenExists(null);

    await expect(verifyApiToken(RAW_TOKEN)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(prisma.apiToken.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an absent token without spending a query on it", async () => {
    await expect(verifyApiToken("")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(prisma.apiToken.findUnique).not.toHaveBeenCalled();
    expect(prisma.apiToken.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a revoked token", async () => {
    tokenExists(makeRow({ revokedAt: new Date("2026-01-01T00:00:00.000Z") }));

    await expect(verifyApiToken(RAW_TOKEN)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(prisma.apiToken.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a row whose stored digest is corrupt", async () => {
    tokenExists(makeRow({ tokenHash: "not-a-digest" }));

    await expect(verifyApiToken(RAW_TOKEN)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("never says which check failed", async () => {
    const refusals = await Promise.all([
      (async () => {
        tokenExists(null);
        return verifyApiToken(RAW_TOKEN);
      })(),
      (async () => {
        tokenExists(makeRow({ revokedAt: new Date() }));
        return verifyApiToken(RAW_TOKEN);
      })(),
    ]);

    for (const refusal of refusals) {
      expect(refusal).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("answers rate_limited when the throttle refuses the claim", async () => {
    claimSucceeds(0);

    await expect(
      verifyApiToken(RAW_TOKEN, { minIntervalMs: ONE_HOUR_MS }),
    ).resolves.toEqual({ ok: false, reason: "rate_limited" });
  });

  it("claims the interval in ONE conditional statement, not a read then a write", async () => {
    await verifyApiToken(RAW_TOKEN, { minIntervalMs: ONE_HOUR_MS });

    const call = vi.mocked(prisma.apiToken.updateMany).mock.calls[0]?.[0] as {
      where: { id: string; OR: unknown[] };
      data: { lastUsedAt: Date };
    };

    expect(call.where.id).toBe("token-1");
    expect(call.where.OR).toHaveLength(2);
    expect(call.data.lastUsedAt).toBeInstanceOf(Date);
  });

  it("calls a vanished row invalid, not rate limited, when there is no throttle", async () => {
    claimSucceeds(0);

    await expect(verifyApiToken(RAW_TOKEN)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "fails closed on a misconfigured minIntervalMs of %o",
    async (minIntervalMs) => {
      await expect(
        verifyApiToken(RAW_TOKEN, { minIntervalMs }),
      ).resolves.toEqual({ ok: false, reason: "invalid" });
      expect(prisma.apiToken.findUnique).not.toHaveBeenCalled();
    },
  );

  it("never returns the presented credential", async () => {
    const result = await verifyApiToken(RAW_TOKEN);

    expect(JSON.stringify(result)).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN_HASH);
  });
});

describe("generateApiToken", () => {
  it("returns a raw token whose stored digest is exactly hashApiToken of it", () => {
    const { raw, tokenHash } = generateApiToken();

    expect(tokenHash).toBe(hashApiToken(raw));
    expect(tokenHash).not.toContain(raw);
  });

  it("carries the API-token prefix over 32 bytes of base64url randomness", () => {
    const { raw } = generateApiToken();

    expect(raw).toMatch(/^slg_api_[A-Za-z0-9_-]{43}$/);
  });

  it("never mints the same token twice", () => {
    const minted = new Set(
      Array.from({ length: 50 }, () => generateApiToken().raw),
    );

    expect(minted.size).toBe(50);
  });

  it("mints a token verifyApiToken accepts as presented, prefix and all", async () => {
    const { raw, tokenHash } = generateApiToken();
    tokenExists(makeRow({ tokenHash }));

    await expect(verifyApiToken(raw)).resolves.toEqual({
      ok: true,
      token: { tokenId: "token-1", name: "Retention cron" },
    });
  });
});
