import { beforeEach, describe, expect, it } from "vitest";

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
  it("takes the leftmost entry of x-forwarded-for, trimmed", () => {
    const headers = new Headers({
      "x-forwarded-for": " 198.51.100.7 , 10.0.0.1, 10.0.0.2",
    });

    expect(resolveClientIp(headers)).toBe("198.51.100.7");
  });

  it("falls back to x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.7" });

    expect(resolveClientIp(headers)).toBe("198.51.100.7");
  });

  it("prefers x-forwarded-for when both are present", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.7",
      "x-real-ip": "203.0.113.9",
    });

    expect(resolveClientIp(headers)).toBe("198.51.100.7");
  });

  it("reports no address when neither header names one", () => {
    expect(resolveClientIp(new Headers())).toBeNull();
    expect(
      resolveClientIp(new Headers({ "x-forwarded-for": " , " })),
    ).toBeNull();
  });

  it("lower-cases an IPv6 literal so hex case cannot multiply the allowance", () => {
    const headers = new Headers({ "x-forwarded-for": "2001:DB8::1" });

    expect(resolveClientIp(headers)).toBe("2001:db8::1");
  });

  it("refuses to key on a value no address could be", () => {
    // A header is attacker-controlled on a deployment with no proxy in front;
    // a kilobyte of it must not become a kilobyte of map key.
    const headers = new Headers({
      "x-forwarded-for": "a".repeat(1_000),
      "x-real-ip": "198.51.100.7",
    });

    expect(resolveClientIp(headers)).toBe("198.51.100.7");
    expect(
      resolveClientIp(new Headers({ "x-forwarded-for": "a".repeat(1_000) })),
    ).toBeNull();
  });
});
