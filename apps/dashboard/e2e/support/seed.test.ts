import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { GeneratedIngestKey, IngestKeyType } from "@/lib/ingest/keys";

import {
  SEED_ADMIN,
  SEED_APPLICATION,
  SEED_EVENT_COUNT,
  SEED_MEMBER,
  SEED_PUBLIC_KEY_NAME,
  SEED_SECRET_KEY_NAME,
  type SeedUser,
  type SeedUserRole,
} from "./fixtures";
import { seedDatabase, type SeedIngestKeyRow, type SeedStore } from "./seed";

/**
 * The seeding logic, proven without a database.
 *
 * The store is a plain in-memory fake rather than a mocked module, which is
 * what lets these tests assert on the ORDER and the SHAPE of the writes — that
 * the keys are replaced rather than appended to, that the role is forced on
 * every run, that an existing account has its password reset instead of being
 * duplicated. None of that is observable through a module mock.
 */

/** A fixed instant, so the corpus is identical on every run. */
const NOW = new Date("2026-09-02T12:00:00.000Z");

const ORIGINS = ["http://127.0.0.1:3000", "http://localhost:3000"] as const;

/** A key generator with no randomness, so assertions can name exact values. */
function fixedKeyGenerator(): (type: IngestKeyType) => GeneratedIngestKey {
  return (type) =>
    type === "PUBLIC"
      ? {
          plaintext: "slg_pub_fixed",
          publicKey: "slg_pub_fixed",
          keyId: null,
          secretHash: null,
        }
      : {
          plaintext: "slg_sec_handle_secret",
          publicKey: null,
          keyId: "handle",
          secretHash: "digest",
        };
}

/** Everything the fake store recorded, for the assertions to read. */
interface FakeStoreState {
  users: Map<string, { email: string; role: SeedUserRole; password: string }>;
  applications: Map<string, string>;
  keys: SeedIngestKeyRow[];
  events: Prisma.LogEventCreateManyInput[];
  deletedKeyNames: string[][];
  deletedEventsFor: string[];
  usageResetFor: string[];
  createdUserEmails: string[];
  passwordResets: string[];
  roleWrites: { userId: string; role: SeedUserRole }[];
}

function createFakeStore(
  seed: {
    existingUsers?: readonly SeedUser[];
    existingApplication?: boolean;
  } = {},
): { store: SeedStore; state: FakeStoreState } {
  const state: FakeStoreState = {
    users: new Map(),
    applications: new Map(),
    keys: [],
    events: [],
    deletedKeyNames: [],
    deletedEventsFor: [],
    usageResetFor: [],
    createdUserEmails: [],
    passwordResets: [],
    roleWrites: [],
  };

  let nextId = 0;
  const mint = (prefix: string): string => `${prefix}-${(nextId += 1)}`;

  for (const user of seed.existingUsers ?? []) {
    // Deliberately wrong role and stale password: a reseed has to correct both.
    state.users.set(mint("user"), {
      email: user.email,
      role: "MEMBER",
      password: "stale",
    });
  }

  if (seed.existingApplication === true) {
    state.applications.set("existing-app", SEED_APPLICATION.slug);
  }

  const findUserEntry = (
    email: string,
  ):
    | [string, { email: string; role: SeedUserRole; password: string }]
    | undefined =>
    [...state.users.entries()].find(([, value]) => value.email === email);

  const store: SeedStore = {
    findUserIdByEmail: async (email) => findUserEntry(email)?.[0] ?? null,

    createUserWithPassword: async (user) => {
      const id = mint("user");
      state.users.set(id, {
        email: user.email,
        role: "MEMBER",
        password: user.password,
      });
      state.createdUserEmails.push(user.email);
      return id;
    },

    resetPassword: async (userId, password) => {
      const existing = state.users.get(userId);
      if (existing !== undefined) existing.password = password;
      state.passwordResets.push(userId);
    },

    setRoleAndActivate: async (userId, role) => {
      const existing = state.users.get(userId);
      if (existing !== undefined) existing.role = role;
      state.roleWrites.push({ userId, role });
    },

    findApplicationIdBySlug: async (slug) =>
      [...state.applications.entries()].find(
        ([, value]) => value === slug,
      )?.[0] ?? null,

    createApplication: async (input) => {
      const id = mint("app");
      state.applications.set(id, input.slug);
      return id;
    },

    deleteIngestKeysByName: async (applicationId, names) => {
      state.deletedKeyNames.push([...names]);
      state.keys = state.keys.filter(
        (key) =>
          key.applicationId !== applicationId || !names.includes(key.name),
      );
    },

    createIngestKey: async (row) => {
      state.keys.push(row);
    },

    deleteLogEvents: async (applicationId) => {
      state.deletedEventsFor.push(applicationId);
      state.events = state.events.filter(
        (row) => row.applicationId !== applicationId,
      );
    },

    createLogEvents: async (rows) => {
      state.events.push(...rows);
      return rows.length;
    },

    resetUsage: async (applicationId) => {
      state.usageResetFor.push(applicationId);
    },
  };

  return { store, state };
}

function run(store: SeedStore) {
  return seedDatabase({
    store,
    allowedOrigins: ORIGINS,
    now: NOW,
    generateKey: fixedKeyGenerator(),
  });
}

describe("seedDatabase", () => {
  it("creates both fixture users on an empty database", async () => {
    const { store, state } = createFakeStore();

    const seeded = await run(store);

    expect(state.createdUserEmails).toEqual([
      SEED_ADMIN.email,
      SEED_MEMBER.email,
    ]);
    expect(seeded.users.map((user) => user.role)).toEqual(["ADMIN", "MEMBER"]);
  });

  it("promotes the admin on the row, because the role is not accepted as input", async () => {
    const { store, state } = createFakeStore();

    await run(store);

    expect(state.roleWrites.map((write) => write.role)).toEqual([
      "ADMIN",
      "MEMBER",
    ]);
  });

  it("reuses an existing account instead of creating a second one", async () => {
    const { store, state } = createFakeStore({
      existingUsers: [SEED_ADMIN, SEED_MEMBER],
    });

    await run(store);

    expect(state.createdUserEmails).toEqual([]);
    expect(state.users.size).toBe(2);
  });

  it("forces an existing account back to the fixture password", async () => {
    const { store, state } = createFakeStore({ existingUsers: [SEED_ADMIN] });

    await run(store);

    const admin = [...state.users.values()].find(
      (user) => user.email === SEED_ADMIN.email,
    );
    expect(admin?.password).toBe(SEED_ADMIN.password);
    expect(state.passwordResets).toHaveLength(1);
  });

  it("re-promotes an account an earlier run left demoted", async () => {
    const { store, state } = createFakeStore({ existingUsers: [SEED_ADMIN] });

    await run(store);

    const admin = [...state.users.values()].find(
      (user) => user.email === SEED_ADMIN.email,
    );
    expect(admin?.role).toBe("ADMIN");
  });

  it("reuses an existing application rather than colliding on its slug", async () => {
    const { store, state } = createFakeStore({ existingApplication: true });

    const seeded = await run(store);

    expect(seeded.applicationId).toBe("existing-app");
    expect(state.applications.size).toBe(1);
  });

  it("mints one public and one secret key, and returns both plaintexts", async () => {
    const { store, state } = createFakeStore();

    const seeded = await run(store);

    expect(state.keys.map((key) => key.type)).toEqual(["PUBLIC", "SECRET"]);
    expect(seeded.publicKey).toBe("slg_pub_fixed");
    expect(seeded.secretKey).toBe("slg_sec_handle_secret");
  });

  it("origin-gates the public key and leaves the secret key unrestricted", async () => {
    const { store, state } = createFakeStore();

    await run(store);

    const [publicKey, secretKey] = state.keys;
    expect(publicKey?.allowedOrigins).toEqual([...ORIGINS]);
    expect(publicKey?.secretHash).toBeNull();
    // A secret key carries no origin restriction: it is the one usable from a
    // server, where `Origin` proves nothing.
    expect(secretKey?.allowedOrigins).toEqual([]);
    expect(secretKey?.publicKey).toBeNull();
    expect(secretKey?.secretHash).toBe("digest");
  });

  it("never persists a secret key's plaintext", async () => {
    const { store, state } = createFakeStore();

    const seeded = await run(store);

    expect(JSON.stringify(state.keys).includes(seeded.secretKey)).toBe(false);
  });

  it("replaces the seeded keys rather than appending to them", async () => {
    const { store, state } = createFakeStore();

    await run(store);
    await run(store);

    expect(state.keys).toHaveLength(2);
    expect(state.deletedKeyNames).toEqual([
      [SEED_PUBLIC_KEY_NAME, SEED_SECRET_KEY_NAME],
      [SEED_PUBLIC_KEY_NAME, SEED_SECRET_KEY_NAME],
    ]);
  });

  it("replaces the log corpus rather than doubling it", async () => {
    const { store, state } = createFakeStore();

    await run(store);
    await run(store);

    expect(state.events).toHaveLength(SEED_EVENT_COUNT);
  });

  it("clears the day's ingest counters so repeated runs cannot exhaust the quota", async () => {
    const { store, state } = createFakeStore();

    const seeded = await run(store);

    expect(state.usageResetFor).toEqual([seeded.applicationId]);
  });

  it("returns the same contract on a second run", async () => {
    const { store } = createFakeStore();

    const first = await run(store);
    const second = await run(store);

    expect(second.applicationId).toBe(first.applicationId);
    expect(second.users).toEqual(first.users);
    expect(second.eventCount).toBe(first.eventCount);
  });

  it("reports the span of the seeded corpus", async () => {
    const { store } = createFakeStore();

    const seeded = await run(store);

    expect(seeded.newestEventAt).toBe(NOW.toISOString());
    expect(new Date(seeded.oldestEventAt).getTime()).toBeLessThan(
      NOW.getTime(),
    );
    expect(seeded.eventCount).toBe(SEED_EVENT_COUNT);
  });

  it("refuses a run whose events were not all written", async () => {
    const { store } = createFakeStore();
    const shortWriter: SeedStore = {
      ...store,
      createLogEvents: async () => 1,
    };

    await expect(run(shortWriter)).rejects.toThrow(
      /expected to write 120 log events but wrote 1/,
    );
  });

  it("refuses a public key generator that returns no literal key", async () => {
    const { store } = createFakeStore();

    await expect(
      seedDatabase({
        store,
        allowedOrigins: ORIGINS,
        now: NOW,
        generateKey: () => ({
          plaintext: "slg_pub_broken",
          publicKey: null,
          keyId: null,
          secretHash: null,
        }),
      }),
    ).rejects.toThrow(/no literal key value/);
  });

  it("refuses a secret key generator that returns no digest", async () => {
    const { store } = createFakeStore();

    await expect(
      seedDatabase({
        store,
        allowedOrigins: ORIGINS,
        now: NOW,
        generateKey: (type) =>
          type === "PUBLIC"
            ? {
                plaintext: "slg_pub_fixed",
                publicKey: "slg_pub_fixed",
                keyId: null,
                secretHash: null,
              }
            : {
                plaintext: "slg_sec_broken",
                publicKey: null,
                keyId: null,
                secretHash: null,
              },
      }),
    ).rejects.toThrow(/no handle or digest/);
  });
});
