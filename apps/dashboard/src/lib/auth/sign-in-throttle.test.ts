import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSignInAttempts,
  consumeSignInAttempt,
  resetSignInThrottle,
  resolveClientIp,
  SIGN_IN_MAX_ATTEMPTS,
  SIGN_IN_MAX_ATTEMPTS_PER_ACCOUNT,
  SIGN_IN_WINDOW_MS,
} from "./sign-in-throttle";

const START = 1_700_000_000_000;

const VICTIM = "victim@example.test";
const VICTIM_IP = "198.51.100.7";
const ATTACKER_IP = "203.0.113.9";

/** Spends every slot one address has against one account. */
function exhaustClientWindow(email: string, ip: string | null, now = START) {
  for (let attempt = 1; attempt <= SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
    consumeSignInAttempt(email, ip, now);
  }
}

beforeEach(() => {
  resetSignInThrottle();
});

describe("consumeSignInAttempt", () => {
  it("allows attempts up to the ceiling", () => {
    for (let attempt = 1; attempt <= SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
      expect(consumeSignInAttempt(VICTIM, ATTACKER_IP, START).allowed).toBe(
        true,
      );
    }
  });

  it("refuses the attempt after the ceiling", () => {
    exhaustClientWindow(VICTIM, ATTACKER_IP);

    expect(consumeSignInAttempt(VICTIM, ATTACKER_IP, START).allowed).toBe(
      false,
    );
  });

  it("throttles one account without throttling another from the same address", () => {
    exhaustClientWindow(VICTIM, ATTACKER_IP);

    expect(consumeSignInAttempt(VICTIM, ATTACKER_IP, START).allowed).toBe(
      false,
    );
    expect(
      consumeSignInAttempt("someone@example.test", ATTACKER_IP, START).allowed,
    ).toBe(true);
  });

  it("does not lock an account for a caller at a different address", () => {
    // The lockout a single account-keyed window handed out: ten guesses of a
    // colleague's address from anywhere locked that colleague out.
    exhaustClientWindow(VICTIM, ATTACKER_IP);
    expect(consumeSignInAttempt(VICTIM, ATTACKER_IP, START).allowed).toBe(
      false,
    );

    expect(consumeSignInAttempt(VICTIM, VICTIM_IP, START).allowed).toBe(true);
  });

  it("locks the account from everywhere once enough addresses have tried it", () => {
    // Addresses are whatever a proxy header says, so a limit keyed on them
    // alone is one a distributed guesser does not have. The account window is
    // the ceiling on that.
    const addressesNeeded = Math.ceil(
      SIGN_IN_MAX_ATTEMPTS_PER_ACCOUNT / SIGN_IN_MAX_ATTEMPTS,
    );
    for (let index = 0; index < addressesNeeded; index += 1) {
      exhaustClientWindow(VICTIM, `203.0.113.${index + 1}`);
    }

    expect(consumeSignInAttempt(VICTIM, VICTIM_IP, START).allowed).toBe(false);
  });

  it("does not let a refused address push the account towards its ceiling", () => {
    // Refused attempts never reach the password hash, so they are not the
    // thing the account window bounds — and counting them would hand a single
    // locked-out address the very lockout the split exists to prevent.
    for (
      let attempt = 0;
      attempt < SIGN_IN_MAX_ATTEMPTS_PER_ACCOUNT * 2;
      attempt += 1
    ) {
      consumeSignInAttempt(VICTIM, ATTACKER_IP, START);
    }

    expect(consumeSignInAttempt(VICTIM, VICTIM_IP, START).allowed).toBe(true);
  });

  it("shares one client window per account when no address is known", () => {
    // "Unknown" is not a network position that distinguishes anybody, so
    // address-less callers fall back to the tight per-account ceiling.
    exhaustClientWindow(VICTIM, null);

    expect(consumeSignInAttempt(VICTIM, null, START).allowed).toBe(false);
  });

  it("does not let address-less callers lock out a caller with an address", () => {
    exhaustClientWindow(VICTIM, null);
    expect(consumeSignInAttempt(VICTIM, null, START).allowed).toBe(false);

    expect(consumeSignInAttempt(VICTIM, VICTIM_IP, START).allowed).toBe(true);
  });

  it("treats an address as the same identity regardless of case or padding", () => {
    for (let attempt = 1; attempt <= SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
      consumeSignInAttempt("Victim@Example.test", ATTACKER_IP, START);
    }

    expect(
      consumeSignInAttempt("  victim@example.test  ", ATTACKER_IP, START)
        .allowed,
    ).toBe(false);
  });

  it("opens the window again once it has elapsed", () => {
    exhaustClientWindow(VICTIM, ATTACKER_IP);
    expect(consumeSignInAttempt(VICTIM, ATTACKER_IP, START).allowed).toBe(
      false,
    );

    expect(
      consumeSignInAttempt(VICTIM, ATTACKER_IP, START + SIGN_IN_WINDOW_MS)
        .allowed,
    ).toBe(true);
  });

  it("reports how long is left, for the message shown to the user", () => {
    exhaustClientWindow(VICTIM, ATTACKER_IP);

    const refused = consumeSignInAttempt(VICTIM, ATTACKER_IP, START + 1_000);

    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe((SIGN_IN_WINDOW_MS - 1_000) / 1_000);
  });

  it("refuses an empty identity rather than pooling every blank attempt", () => {
    expect(consumeSignInAttempt("", ATTACKER_IP, START).allowed).toBe(false);
    expect(consumeSignInAttempt("   ", null, START).allowed).toBe(false);
  });

  it("does not grow without bound as identities churn", () => {
    for (let index = 0; index < 20_000; index += 1) {
      consumeSignInAttempt(
        `user-${index}@example.test`,
        `203.0.113.${index % 250}`,
        START + index,
      );
    }

    // Still counting: eviction must never hand out an unlimited allowance.
    exhaustClientWindow("steady@example.test", VICTIM_IP, START + 20_000);

    expect(
      consumeSignInAttempt("steady@example.test", VICTIM_IP, START + 20_000)
        .allowed,
    ).toBe(false);
  });
});

describe("clearSignInAttempts", () => {
  it("forgets the attempts a successful sign-in was preceded by", () => {
    // Ten legitimate sign-ins in a quarter of an hour are not a lockout.
    for (let attempt = 1; attempt < SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
      consumeSignInAttempt(VICTIM, VICTIM_IP, START);
    }

    clearSignInAttempts(VICTIM, VICTIM_IP);

    for (let attempt = 1; attempt <= SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
      expect(consumeSignInAttempt(VICTIM, VICTIM_IP, START).allowed).toBe(true);
    }
  });

  it("clears the account window too, so a success resets the distributed ceiling", () => {
    const addressesNeeded = Math.ceil(
      SIGN_IN_MAX_ATTEMPTS_PER_ACCOUNT / SIGN_IN_MAX_ATTEMPTS,
    );
    for (let index = 0; index < addressesNeeded; index += 1) {
      exhaustClientWindow(VICTIM, `203.0.113.${index + 1}`);
    }
    expect(consumeSignInAttempt(VICTIM, VICTIM_IP, START).allowed).toBe(false);

    clearSignInAttempts(VICTIM, VICTIM_IP);

    expect(consumeSignInAttempt(VICTIM, VICTIM_IP, START).allowed).toBe(true);
  });

  it("does not unlock another address that is still guessing", () => {
    exhaustClientWindow(VICTIM, ATTACKER_IP);

    clearSignInAttempts(VICTIM, VICTIM_IP);

    expect(consumeSignInAttempt(VICTIM, ATTACKER_IP, START).allowed).toBe(
      false,
    );
  });

  it("matches the identity normalisation used when counting", () => {
    exhaustClientWindow(VICTIM, VICTIM_IP);

    clearSignInAttempts("  Victim@Example.test ", VICTIM_IP);

    expect(consumeSignInAttempt(VICTIM, VICTIM_IP, START).allowed).toBe(true);
  });

  it("ignores an empty identity", () => {
    expect(() => clearSignInAttempts("", VICTIM_IP)).not.toThrow();
  });
});

describe("resolveClientIp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("knows no address with no trusted proxy, so attempts key on the account alone", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", undefined);
    vi.stubEnv("VERCEL", undefined);

    expect(
      resolveClientIp(new Headers({ "x-forwarded-for": "198.51.100.7" })),
    ).toBeNull();
  });

  it("takes the entry the trusted proxy appended, never the client's forged first one", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");

    expect(
      resolveClientIp(
        new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.7" }),
      ),
    ).toBe("198.51.100.7");
  });

  it("cannot be handed fresh windows by inventing addresses", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", undefined);
    vi.stubEnv("VERCEL", undefined);

    // With no trusted proxy every invented address resolves to "unknown", so
    // all of them draw on the one strict window for the account.
    for (let attempt = 0; attempt < SIGN_IN_MAX_ATTEMPTS; attempt += 1) {
      const forged = new Headers({ "x-forwarded-for": `203.0.113.${attempt}` });
      expect(
        consumeSignInAttempt("victim@example.test", resolveClientIp(forged))
          .allowed,
      ).toBe(true);
    }

    const next = new Headers({ "x-forwarded-for": "203.0.113.250" });
    expect(
      consumeSignInAttempt("victim@example.test", resolveClientIp(next))
        .allowed,
    ).toBe(false);
  });
});
