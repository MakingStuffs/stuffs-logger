import type { Prisma } from "@prisma/client";

/**
 * The seeded data contract.
 *
 * Everything here is PURE — literals and deterministic builders, no database,
 * no clock of its own. That is what lets the whole contract be unit-tested by
 * Vitest with no Postgres, and it is why a spec can assert on exact values
 * without querying anything.
 *
 * These values are the interface between the seeder and every spec written
 * against it. CHANGING ONE IS A BREAKING CHANGE for every spec that asserts on
 * it, so add rather than repurpose.
 */

/** The role column's two values, mirroring the `UserRole` enum in the schema. */
export type SeedUserRole = "ADMIN" | "MEMBER";

/** A user the suite can sign in as. */
export interface SeedUser {
  email: string;
  password: string;
  name: string;
  role: SeedUserRole;
  /** Where this role's Playwright storage state is written. */
  storageStatePath: string;
}

/**
 * Fixture credentials.
 *
 * THESE ARE NOT SECRETS AND MUST NEVER BECOME ONE. They exist only in the
 * disposable database the e2e run seeds and truncates; no suite that touches a
 * deployed environment creates or uses them (the smoke suite is unauthenticated
 * by design — see `specs/smoke.spec.ts`). They are literals rather than
 * environment variables because a spec has to be able to state "sign in as the
 * admin" without the value shifting underneath it.
 *
 * Each one can still be overridden from the environment, so an operator who
 * wants the suite pointed at a hardened, longer-lived database can supply
 * their own credentials without editing code.
 */
const ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password-2f9c";
const MEMBER_PASSWORD =
  process.env.E2E_MEMBER_PASSWORD ?? "e2e-member-password-7b41";

/**
 * Where the run's own state lives: one storage state per role, plus the seed
 * manifest.
 *
 * RELATIVE TO `apps/dashboard`, which is the working directory every e2e
 * script runs in. Playwright resolves `storageState` paths against the process
 * cwd rather than the config file, so an absolute path derived from
 * `import.meta` would be the safer-looking choice but would have to survive
 * Playwright's CJS transform; pinning the cwd in the scripts is the simpler
 * guarantee. Gitignored — a storage state is a live session cookie.
 */
export const E2E_STATE_DIR = "e2e/.state";

/** The administrator. The only role that may see or mint ingest keys. */
export const SEED_ADMIN: SeedUser = {
  email: process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@stuffs-logger.test",
  password: ADMIN_PASSWORD,
  name: "E2E Admin",
  role: "ADMIN",
  storageStatePath: `${E2E_STATE_DIR}/auth-admin.json`,
};

/** An ordinary member. Reads logs and applications; refused ingest keys. */
export const SEED_MEMBER: SeedUser = {
  email: process.env.E2E_MEMBER_EMAIL ?? "e2e-member@stuffs-logger.test",
  password: MEMBER_PASSWORD,
  name: "E2E Member",
  role: "MEMBER",
  storageStatePath: `${E2E_STATE_DIR}/auth-member.json`,
};

/** Both seeded users, in the order the setup project creates them. */
export const SEED_USERS: readonly SeedUser[] = [SEED_ADMIN, SEED_MEMBER];

/** The one seeded application. Its slug is the `/apps/<slug>` route segment. */
export const SEED_APPLICATION = {
  slug: "e2e-checkout",
  name: "E2E Checkout",
  description: "Seeded by the Playwright harness. Safe to truncate.",
} as const;

/** The label on the seeded browser-safe key, as shown in the key list. */
export const SEED_PUBLIC_KEY_NAME = "E2E public key";

/** The label on the seeded server-side key. */
export const SEED_SECRET_KEY_NAME = "E2E secret key";

/** Both seeded key labels — the set the seeder replaces on every run. */
export const SEED_KEY_NAMES: readonly string[] = [
  SEED_PUBLIC_KEY_NAME,
  SEED_SECRET_KEY_NAME,
];

/**
 * The environments the seeded events are split across.
 *
 * Two, not one, so a spec can prove the environment filter actually narrows
 * rather than merely returning everything.
 */
export const SEED_ENVIRONMENTS = ["production", "staging"] as const;

/** A seeded event's environment. */
export type SeedEnvironment = (typeof SEED_ENVIRONMENTS)[number];

/** The build identifier stamped on every seeded event. */
export const SEED_RELEASE = "e2e-1.0.0";

/**
 * A marker present in every seeded message.
 *
 * Gives a spec one search term that matches the whole seeded corpus and
 * nothing else, so an assertion can be written against a filtered view rather
 * than against total row counts — which would break the moment a sibling spec
 * ingested something of its own.
 */
export const SEED_MESSAGE_MARKER = "e2e-seed";

/** How many events the seeder writes. */
export const SEED_EVENT_COUNT = 120;

/**
 * The gap between consecutive seeded events.
 *
 * Ninety seconds, so the whole corpus spans three hours: comfortably inside
 * the overview's 24-hour window (every seeded event counts towards it) while
 * still giving the explorer's date filters a real range to cut.
 */
export const SEED_EVENT_INTERVAL_MS = 90_000;

/**
 * The level rotation.
 *
 * Deliberately NOT a uniform spread: `INFO` appears three times per cycle and
 * `FATAL` once, so a level filter changes the result count visibly rather than
 * returning a suspiciously round fraction of the corpus.
 */
export const SEED_LEVEL_CYCLE = [
  "INFO",
  "WARN",
  "ERROR",
  "INFO",
  "DEBUG",
  "TRACE",
  "INFO",
  "FATAL",
] as const;

/** A level in {@link SEED_LEVEL_CYCLE}. */
export type SeedLevel = (typeof SEED_LEVEL_CYCLE)[number];

/**
 * How many seeded events carry each level.
 *
 * Derived from the cycle rather than written down twice, so it cannot drift
 * from what {@link buildSeedLogEvents} actually produces.
 *
 * @returns A count per level, for the levels that appear at all.
 * @example
 * seedLevelCounts().ERROR; // 15
 */
export function seedLevelCounts(): Readonly<
  Partial<Record<SeedLevel, number>>
> {
  const counts: Partial<Record<SeedLevel, number>> = {};

  for (let index = 0; index < SEED_EVENT_COUNT; index += 1) {
    const level = levelAt(index);
    counts[level] = (counts[level] ?? 0) + 1;
  }

  return counts;
}

/** Options for {@link buildSeedLogEvents}. */
export interface BuildSeedLogEventsOptions {
  /** The application every row is attributed to. */
  applicationId: string;
  /**
   * The instant the newest seeded event carries. Injected rather than read
   * from the clock so the builder is deterministic and its tests cannot flake
   * at a date boundary.
   */
  now: Date;
}

/**
 * Builds the seeded log corpus.
 *
 * Ordered NEWEST FIRST, matching the explorer's own default ordering, so the
 * first row of the first page is `events[0]` and a spec can assert on it
 * without re-deriving the sort.
 *
 * Every row is written through Prisma's own `LogEventCreateManyInput`, so the
 * seeded corpus and the ingest endpoint's output are the same shape — a seeded
 * row and an ingested one are indistinguishable to the dashboard, which is
 * what makes the round-trip assertion meaningful.
 *
 * @param options - See {@link BuildSeedLogEventsOptions}.
 * @returns {@link SEED_EVENT_COUNT} rows, newest first.
 */
export function buildSeedLogEvents(
  options: BuildSeedLogEventsOptions,
): Prisma.LogEventCreateManyInput[] {
  const { applicationId, now } = options;
  const rows: Prisma.LogEventCreateManyInput[] = [];

  for (let index = 0; index < SEED_EVENT_COUNT; index += 1) {
    const timestamp = new Date(now.getTime() - index * SEED_EVENT_INTERVAL_MS);
    const level = levelAt(index);
    const isBrowser = index % 2 === 0;
    const isError = level === "ERROR" || level === "FATAL";

    rows.push({
      applicationId,
      timestamp,
      // The server clock, which retention sweeps on. Held equal to the client
      // clock so a seeded row is never a candidate for the retention job while
      // a spec is looking at it.
      receivedAt: timestamp,
      level,
      message: `${SEED_MESSAGE_MARKER} ${level.toLowerCase()} #${String(index).padStart(3, "0")}`,
      logger: isError && isBrowser ? "ONERROR" : "MANUAL",
      context: { seedIndex: index, marker: SEED_MESSAGE_MARKER },
      environment: environmentAt(index),
      release: SEED_RELEASE,
      source: isBrowser ? "BROWSER" : "NODE",
      sessionId: `${SEED_MESSAGE_MARKER}-session-${index % 4}`,
      url: isBrowser ? `https://example.test/checkout/step-${index % 4}` : null,
      userAgent: isBrowser ? SEED_BROWSER_USER_AGENT : null,
      deviceType: isBrowser ? deviceAt(index) : null,
      os: isBrowser ? "macOS" : null,
      browser: isBrowser ? "Chrome" : null,
      errorName: isError ? "SeedError" : null,
      errorMessage: isError ? `Seeded failure at index ${index}` : null,
      errorStack: isError
        ? `SeedError: Seeded failure at index ${index}\n    at seed (e2e/support/fixtures.ts:1:1)`
        : null,
    });
  }

  return rows;
}

/** The user agent stamped on every seeded browser event. */
const SEED_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** The device classes seeded browser events rotate through. */
const SEED_DEVICE_CYCLE = ["DESKTOP", "MOBILE", "TABLET"] as const;

function levelAt(index: number): SeedLevel {
  const level = SEED_LEVEL_CYCLE[index % SEED_LEVEL_CYCLE.length];

  // `noUncheckedIndexedAccess` cannot see that the modulus keeps the index in
  // range, and a non-null assertion would hide a real error if the cycle were
  // ever emptied.
  if (level === undefined) throw new Error("SEED_LEVEL_CYCLE is empty");

  return level;
}

function environmentAt(index: number): SeedEnvironment {
  // Three production events to one staging event: a realistic ratio, and one
  // where filtering to staging is obviously not "everything".
  return index % 4 === 3 ? "staging" : "production";
}

function deviceAt(index: number): (typeof SEED_DEVICE_CYCLE)[number] {
  // Floored because only even indices are browser events: without it an odd
  // index would produce a fractional lookup and `undefined`.
  const slot = Math.floor(index / 2) % SEED_DEVICE_CYCLE.length;
  const device = SEED_DEVICE_CYCLE[slot];
  if (device === undefined) throw new Error("SEED_DEVICE_CYCLE is empty");

  return device;
}
