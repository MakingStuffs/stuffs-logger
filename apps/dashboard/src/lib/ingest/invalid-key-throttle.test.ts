import { beforeEach, describe, expect, it } from "vitest";

import {
  checkInvalidKeyThrottle,
  clientIpFromHeaders,
  INVALID_KEY_MAX_REFUSALS,
  INVALID_KEY_MAX_TRACKED_CLIENTS,
  INVALID_KEY_WINDOW_MS,
  recordInvalidKeyRefusal,
  resetInvalidKeyThrottle,
} from "./invalid-key-throttle";

const NOW = 1_756_728_000_000;
const CLIENT = "203.0.113.9";

/** Spends the whole allowance for one address at `at`. */
function exhaust(clientIp: string, at: number = NOW): void {
  for (let refusal = 0; refusal < INVALID_KEY_MAX_REFUSALS; refusal += 1) {
    recordInvalidKeyRefusal(clientIp, at);
  }
}

describe("clientIpFromHeaders", () => {
  it("takes the first x-forwarded-for entry, trimmed", () => {
    const headers = new Headers({
      "x-forwarded-for": "  203.0.113.9 , 10.0.0.1, 10.0.0.2",
    });

    expect(clientIpFromHeaders(headers)).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.4" });

    expect(clientIpFromHeaders(headers)).toBe("198.51.100.4");
  });

  it("falls back to x-real-ip when the forwarded entry is empty", () => {
    const headers = new Headers({
      "x-forwarded-for": ", 10.0.0.1",
      "x-real-ip": "198.51.100.4",
    });

    expect(clientIpFromHeaders(headers)).toBe("198.51.100.4");
  });

  it("prefers x-forwarded-for over x-real-ip when both are present", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.9",
      "x-real-ip": "198.51.100.4",
    });

    expect(clientIpFromHeaders(headers)).toBe("203.0.113.9");
  });

  it("reports no address when neither header is present", () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });

  it("reports no address for a value too long to be one", () => {
    const headers = new Headers({ "x-forwarded-for": "9".repeat(65) });

    expect(clientIpFromHeaders(headers)).toBeNull();
  });

  it("accepts a bracketed IPv6 address with a port", () => {
    const headers = new Headers({
      "x-forwarded-for": "[2001:db8:85a3:8d3:1319:8a2e:370:7348]:65535",
    });

    expect(clientIpFromHeaders(headers)).toBe(
      "[2001:db8:85a3:8d3:1319:8a2e:370:7348]:65535",
    );
  });
});

describe("invalid-key throttle", () => {
  beforeEach(() => {
    resetInvalidKeyThrottle();
  });

  it("does not throttle an address it has never seen", () => {
    expect(checkInvalidKeyThrottle(CLIENT, NOW)).toEqual({ throttled: false });
  });

  it("does not throttle until the allowance is spent", () => {
    for (
      let refusal = 0;
      refusal < INVALID_KEY_MAX_REFUSALS - 1;
      refusal += 1
    ) {
      recordInvalidKeyRefusal(CLIENT, NOW);
    }

    expect(checkInvalidKeyThrottle(CLIENT, NOW).throttled).toBe(false);
  });

  it("throttles once the allowance is spent", () => {
    exhaust(CLIENT);

    expect(checkInvalidKeyThrottle(CLIENT, NOW).throttled).toBe(true);
  });

  it("consulting the throttle does not count as a refusal", () => {
    for (
      let refusal = 0;
      refusal < INVALID_KEY_MAX_REFUSALS - 1;
      refusal += 1
    ) {
      recordInvalidKeyRefusal(CLIENT, NOW);
    }

    for (let check = 0; check < 100; check += 1) {
      checkInvalidKeyThrottle(CLIENT, NOW);
    }

    expect(checkInvalidKeyThrottle(CLIENT, NOW).throttled).toBe(false);
  });

  it("reports how long until the window resets", () => {
    exhaust(CLIENT);

    const result = checkInvalidKeyThrottle(CLIENT, NOW + 15_000);

    expect(result).toEqual({ throttled: true, retryAfterSeconds: 45 });
  });

  it("counts each address separately", () => {
    exhaust(CLIENT);

    expect(checkInvalidKeyThrottle("198.51.100.4", NOW).throttled).toBe(false);
  });

  it("lets the address through again once the window has passed", () => {
    exhaust(CLIENT);
    expect(checkInvalidKeyThrottle(CLIENT, NOW).throttled).toBe(true);

    expect(
      checkInvalidKeyThrottle(CLIENT, NOW + INVALID_KEY_WINDOW_MS).throttled,
    ).toBe(false);
  });

  it("starts a fresh window for a refusal after the old one expired", () => {
    exhaust(CLIENT);

    recordInvalidKeyRefusal(CLIENT, NOW + INVALID_KEY_WINDOW_MS);

    expect(
      checkInvalidKeyThrottle(CLIENT, NOW + INVALID_KEY_WINDOW_MS).throttled,
    ).toBe(false);
  });

  it("keeps counting the newest address once the tracked cap is reached", () => {
    for (let index = 0; index < INVALID_KEY_MAX_TRACKED_CLIENTS; index += 1) {
      recordInvalidKeyRefusal(
        `10.0.${Math.floor(index / 256)}.${index % 256}`,
        NOW,
      );
    }

    exhaust(CLIENT, NOW + 1);

    expect(checkInvalidKeyThrottle(CLIENT, NOW + 1).throttled).toBe(true);
  });
});
