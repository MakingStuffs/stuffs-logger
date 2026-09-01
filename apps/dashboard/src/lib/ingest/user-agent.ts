import type { DeviceType } from "@jf-logger/core";

/**
 * Coarse device / OS / browser derivation from a user-agent string.
 *
 * Deliberately small and hand-rolled rather than a full UA database: the
 * dashboard needs enough to answer "is this only happening on mobile Safari?",
 * not analytics-grade fidelity. The string is attacker-controlled, so every
 * pattern below is anchored and bounded, and nothing is echoed back into the
 * derived fields — they can only ever be one of a fixed set of literals.
 */

/** What a user agent was parsed into. */
export interface ParsedUserAgent {
  deviceType: DeviceType;
  /** A fixed OS label, or null when unrecognised. */
  os: string | null;
  /** A fixed browser label, or null when unrecognised. */
  browser: string | null;
}

const UNPARSED: ParsedUserAgent = {
  deviceType: "unknown",
  os: null,
  browser: null,
};

/** Bound on how much of the string is inspected, so a huge UA cannot burn CPU. */
const MAX_INSPECTED_LENGTH = 512;

/** Bot markers checked first: a crawler also matches the OS/browser patterns. */
const BOT_PATTERNS = [
  "bot",
  "crawler",
  "spider",
  "crawling",
  "slurp",
  "curl/",
  "wget/",
  "headlesschrome",
  "python-requests",
  "postmanruntime",
  "node-fetch",
  "axios/",
  "lighthouse",
  "pingdom",
  "monitoring",
] as const;

/** Ordered: the first match wins, so more specific labels come first. */
const OS_PATTERNS: ReadonlyArray<readonly [pattern: string, label: string]> = [
  ["windows nt", "Windows"],
  ["android", "Android"],
  ["iphone os", "iOS"],
  ["cpu os", "iOS"],
  ["ipad", "iOS"],
  ["mac os x", "macOS"],
  ["cros", "ChromeOS"],
  ["ubuntu", "Linux"],
  ["linux", "Linux"],
];

/**
 * Ordered most-specific first. Every Chromium browser claims "Safari" and most
 * claim "Chrome", so Edge and Opera must be tested before Chrome, and Chrome
 * before Safari, or everything collapses into one label.
 */
const BROWSER_PATTERNS: ReadonlyArray<
  readonly [pattern: string, label: string]
> = [
  ["edg/", "Edge"],
  ["edga/", "Edge"],
  ["opr/", "Opera"],
  ["opera", "Opera"],
  ["samsungbrowser", "Samsung Internet"],
  ["firefox/", "Firefox"],
  ["fxios/", "Firefox"],
  ["crios/", "Chrome"],
  ["chrome/", "Chrome"],
  ["chromium/", "Chrome"],
  ["safari/", "Safari"],
];

function matchLabel(
  haystack: string,
  patterns: ReadonlyArray<readonly [string, string]>,
): string | null {
  for (const [pattern, label] of patterns) {
    if (haystack.includes(pattern)) return label;
  }
  return null;
}

function deriveDeviceType(haystack: string): DeviceType {
  for (const pattern of BOT_PATTERNS) {
    if (haystack.includes(pattern)) return "bot";
  }

  // Checked before "mobile": an iPad's UA contains neither, and an Android
  // tablet is precisely an Android UA WITHOUT the "mobile" token.
  if (haystack.includes("ipad") || haystack.includes("tablet")) return "tablet";
  if (haystack.includes("android") && !haystack.includes("mobile"))
    return "tablet";

  if (
    haystack.includes("mobile") ||
    haystack.includes("iphone") ||
    haystack.includes("ipod") ||
    haystack.includes("android")
  ) {
    return "mobile";
  }

  if (
    haystack.includes("windows") ||
    haystack.includes("macintosh") ||
    haystack.includes("mac os x") ||
    haystack.includes("linux") ||
    haystack.includes("cros") ||
    haystack.includes("x11")
  ) {
    return "desktop";
  }

  return "unknown";
}

/**
 * Derives coarse device facets from a user-agent string.
 *
 * @param userAgent - The reported user agent, or `null`/`undefined` when absent
 *   (every Node batch, and any browser that withheld it).
 * @returns Fixed-vocabulary facets; `unknown`/`null` when nothing matched.
 * @example
 * parseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) … Safari/604.1");
 * // { deviceType: "mobile", os: "iOS", browser: "Safari" }
 */
export function parseUserAgent(
  userAgent: string | null | undefined,
): ParsedUserAgent {
  if (typeof userAgent !== "string" || userAgent.length === 0) return UNPARSED;

  const haystack = userAgent.slice(0, MAX_INSPECTED_LENGTH).toLowerCase();

  return {
    deviceType: deriveDeviceType(haystack),
    os: matchLabel(haystack, OS_PATTERNS),
    browser: matchLabel(haystack, BROWSER_PATTERNS),
  };
}
