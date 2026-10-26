import type { Prisma } from "@prisma/client";

import {
  generateIngestKey,
  type GeneratedIngestKey,
  type IngestKeyType,
} from "@/lib/ingest/keys";

import {
  buildSeedLogEvents,
  SEED_APPLICATION,
  SEED_EVENT_COUNT,
  SEED_KEY_NAMES,
  SEED_PUBLIC_KEY_NAME,
  SEED_SECRET_KEY_NAME,
  SEED_USERS,
  type SeedUser,
  type SeedUserRole,
} from "./fixtures";

/**
 * The seeding logic, written against an INJECTED store.
 *
 * The same shape as `src/lib/ingest/keys.ts` and `src/lib/ingest/quota.ts`,
 * and for the same reason: every branch below — the account already exists,
 * the application already exists, the keys are being replaced — is exercised
 * by a real unit test against an in-memory store instead of needing a
 * Postgres. The Prisma- and Better-Auth-backed implementation of the store is
 * in `./seed-store.ts`, which is the only file here that touches a database.
 *
 * IDEMPOTENCE IS A REQUIREMENT, not a nicety. The suite reseeds on every run,
 * against a database that may already carry the last run's rows, so each step
 * below is written as "make it so" rather than "create it": users are found or
 * created and then forced to the fixture password and role, and the keys and
 * the log corpus are replaced wholesale rather than appended to.
 */

/** The columns a seeded ingest key row carries. */
export interface SeedIngestKeyRow {
  applicationId: string;
  type: IngestKeyType;
  name: string;
  /** PUBLIC only: the literal key value. */
  publicKey: string | null;
  /** SECRET only: the non-secret lookup handle. */
  keyId: string | null;
  /** SECRET only: the digest of the secret segment. */
  secretHash: string | null;
  /** PUBLIC only: the exact origins the key may be used from. */
  allowedOrigins: string[];
}

/**
 * Every write the seeder makes.
 *
 * Deliberately narrow and verb-shaped: no method takes a query, a selector or
 * a `where` object, so the fake used in the tests cannot diverge from the real
 * one by supporting a shape the real one does not.
 */
export interface SeedStore {
  /** @returns The user's id, or `null` when no account has that address. */
  findUserIdByEmail(email: string): Promise<string | null>;
  /**
   * Creates a user with a working email-and-password credential.
   *
   * @returns The new user's id.
   */
  createUserWithPassword(user: SeedUser): Promise<string>;
  /** Forces an existing account's password back to the fixture value. */
  resetPassword(userId: string, password: string): Promise<void>;
  /**
   * Sets the columns Better Auth refuses as input.
   *
   * `role` and `isActive` are declared `input: false` in
   * `src/lib/auth/auth.ts`, so no creation call can carry them and they are
   * written to the row afterwards.
   */
  setRoleAndActivate(userId: string, role: SeedUserRole): Promise<void>;

  /** @returns The application's id, or `null` when the slug is unknown. */
  findApplicationIdBySlug(slug: string): Promise<string | null>;
  /** @returns The new application's id. */
  createApplication(input: {
    slug: string;
    name: string;
    description: string;
  }): Promise<string>;

  /** Removes the seeded keys so the next run's are the only live ones. */
  deleteIngestKeysByName(
    applicationId: string,
    names: readonly string[],
  ): Promise<void>;
  createIngestKey(row: SeedIngestKeyRow): Promise<void>;

  /** Removes every event belonging to the seeded application. */
  deleteLogEvents(applicationId: string): Promise<void>;
  /** @returns How many rows were written. */
  createLogEvents(rows: Prisma.LogEventCreateManyInput[]): Promise<number>;

  /**
   * Clears the application's daily ingest counters.
   *
   * Without this, a hundred reseeds in one UTC day would walk the durable
   * quota upwards until the round-trip spec started being refused with a 429
   * for reasons that have nothing to do with the code under test.
   */
  resetUsage(applicationId: string): Promise<void>;
}

/** What a seeded user looks like to a spec. Never carries a hash. */
export interface SeededUser {
  id: string;
  email: string;
  password: string;
  role: SeedUserRole;
  storageStatePath: string;
}

/**
 * Everything a spec needs to know about the state it is running against.
 *
 * Serialised to `e2e/.state/seed.json` by the seed setup project and read back
 * by the specs — see `./manifest.ts`. The ingest keys are here because they
 * are minted fresh on every run and are unrecoverable afterwards by design.
 */
export interface SeededData {
  applicationId: string;
  applicationSlug: string;
  applicationName: string;
  /** The literal `slg_pub_…` key. Origin-gated, safe in a browser page. */
  publicKey: string;
  /** The one-time `slg_sec_…` key. Server-side only. */
  secretKey: string;
  users: readonly SeededUser[];
  /** How many events the corpus contains, before any spec adds its own. */
  eventCount: number;
  /** The newest seeded event's instant, ISO-8601. */
  newestEventAt: string;
  /** The oldest seeded event's instant, ISO-8601. */
  oldestEventAt: string;
}

/** Options for {@link seedDatabase}. */
export interface SeedDatabaseOptions {
  store: SeedStore;
  /**
   * Exact origins the seeded PUBLIC key may be presented from. A public key is
   * gated on nothing else, so this list decides whether the round-trip spec's
   * page can reach ingest at all.
   */
  allowedOrigins: readonly string[];
  /** The instant the newest seeded event carries. Injected for determinism. */
  now: Date;
  /**
   * The key generator. Defaults to the application's own
   * {@link generateIngestKey}, so a seeded key is minted exactly the way the
   * ingest-key dialog mints one — the tests substitute a deterministic stub.
   */
  generateKey?: (type: IngestKeyType) => GeneratedIngestKey;
}

/**
 * Brings the database to the state every spec expects.
 *
 * @param options - See {@link SeedDatabaseOptions}.
 * @returns The seeded contract, including the two one-time key values.
 * @throws {Error} When a key generator returns a key of the wrong shape.
 * @example
 * const seeded = await seedDatabase({
 *   store: prismaSeedStore,
 *   allowedOrigins: ["http://127.0.0.1:3000"],
 *   now: new Date(),
 * });
 */
export async function seedDatabase(
  options: SeedDatabaseOptions,
): Promise<SeededData> {
  const { store, allowedOrigins, now } = options;
  const generateKey = options.generateKey ?? generateIngestKey;

  const users: SeededUser[] = [];
  for (const user of SEED_USERS) {
    users.push(await upsertUser(store, user));
  }

  const applicationId = await upsertApplication(store);

  // Replaced rather than added to: a run that appended would leave the
  // previous run's live keys behind, and "which key is current" would stop
  // being answerable from the manifest.
  await store.deleteIngestKeysByName(applicationId, SEED_KEY_NAMES);

  const publicKey = await mintPublicKey(store, {
    applicationId,
    allowedOrigins,
    generateKey,
  });
  const secretKey = await mintSecretKey(store, { applicationId, generateKey });

  await store.deleteLogEvents(applicationId);
  await store.resetUsage(applicationId);

  const rows = buildSeedLogEvents({ applicationId, now });
  const written = await store.createLogEvents(rows);

  if (written !== SEED_EVENT_COUNT) {
    throw new Error(
      `Seed expected to write ${SEED_EVENT_COUNT} log events but wrote ${written}.`,
    );
  }

  return {
    applicationId,
    applicationSlug: SEED_APPLICATION.slug,
    applicationName: SEED_APPLICATION.name,
    publicKey,
    secretKey,
    users,
    eventCount: written,
    newestEventAt: isoOf(rows, 0),
    oldestEventAt: isoOf(rows, rows.length - 1),
  };
}

async function upsertUser(
  store: SeedStore,
  user: SeedUser,
): Promise<SeededUser> {
  const existing = await store.findUserIdByEmail(user.email);

  const id =
    existing === null
      ? await store.createUserWithPassword(user)
      : await resetExisting(store, existing, user.password);

  // Always, not only on creation: an earlier run may have left the account
  // deactivated or demoted, and a spec that signs in as "the admin" must get
  // an admin regardless of what happened before it.
  await store.setRoleAndActivate(id, user.role);

  return {
    id,
    email: user.email,
    password: user.password,
    role: user.role,
    storageStatePath: user.storageStatePath,
  };
}

async function resetExisting(
  store: SeedStore,
  userId: string,
  password: string,
): Promise<string> {
  await store.resetPassword(userId, password);

  return userId;
}

async function upsertApplication(store: SeedStore): Promise<string> {
  const existing = await store.findApplicationIdBySlug(SEED_APPLICATION.slug);
  if (existing !== null) return existing;

  return store.createApplication({
    slug: SEED_APPLICATION.slug,
    name: SEED_APPLICATION.name,
    description: SEED_APPLICATION.description,
  });
}

interface MintOptions {
  applicationId: string;
  generateKey: (type: IngestKeyType) => GeneratedIngestKey;
}

async function mintPublicKey(
  store: SeedStore,
  options: MintOptions & { allowedOrigins: readonly string[] },
): Promise<string> {
  const generated = options.generateKey("PUBLIC");

  if (generated.publicKey === null) {
    throw new Error("Public key generation returned no literal key value.");
  }

  await store.createIngestKey({
    applicationId: options.applicationId,
    type: "PUBLIC",
    name: SEED_PUBLIC_KEY_NAME,
    publicKey: generated.publicKey,
    keyId: null,
    secretHash: null,
    allowedOrigins: [...options.allowedOrigins],
  });

  return generated.plaintext;
}

async function mintSecretKey(
  store: SeedStore,
  options: MintOptions,
): Promise<string> {
  const generated = options.generateKey("SECRET");

  if (generated.keyId === null || generated.secretHash === null) {
    throw new Error("Secret key generation returned no handle or digest.");
  }

  await store.createIngestKey({
    applicationId: options.applicationId,
    type: "SECRET",
    name: SEED_SECRET_KEY_NAME,
    publicKey: null,
    keyId: generated.keyId,
    secretHash: generated.secretHash,
    // A secret key carries no origin restriction: it is the one that may be
    // used from a server, where `Origin` means nothing.
    allowedOrigins: [],
  });

  return generated.plaintext;
}

function isoOf(
  rows: readonly Prisma.LogEventCreateManyInput[],
  index: number,
): string {
  const row = rows[index];
  if (row === undefined) throw new Error("Seed produced no log events.");

  const { timestamp } = row;
  if (!(timestamp instanceof Date)) {
    throw new Error("Seed log events must carry a Date timestamp.");
  }

  return timestamp.toISOString();
}
