import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import { E2E_STATE_DIR } from "./fixtures";
import type { SeededData } from "./seed";

/**
 * How the seed setup project tells the specs what it created.
 *
 * The ingest keys are minted fresh on every run and a SECRET key is
 * unrecoverable by construction, so there is no way to re-derive them: they
 * have to be handed forward. Playwright's projects run in separate worker
 * processes, so a module-level variable would not survive the hop — a file is
 * the seam.
 *
 * READ BACK THROUGH A SCHEMA, not a cast. The file is written by one process
 * and read by another, and a stale or truncated one from an interrupted run is
 * exactly the kind of thing that would otherwise surface as an
 * incomprehensible failure three assertions later.
 */

/** Where the manifest is written. Gitignored, alongside the storage states. */
export const SEED_MANIFEST_PATH = `${E2E_STATE_DIR}/seed.json`;

const seededUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  password: z.string().min(1),
  role: z.enum(["ADMIN", "MEMBER"]),
  storageStatePath: z.string().min(1),
});

const seededDataSchema = z.object({
  applicationId: z.string().min(1),
  applicationSlug: z.string().min(1),
  applicationName: z.string().min(1),
  publicKey: z.string().min(1),
  secretKey: z.string().min(1),
  users: z.array(seededUserSchema).min(1),
  eventCount: z.number().int().positive(),
  newestEventAt: z.string().min(1),
  oldestEventAt: z.string().min(1),
});

/**
 * Records what the seed created.
 *
 * @param data - The seeder's result.
 * @example
 * await writeSeedManifest(await seedDatabase({ … }));
 */
export async function writeSeedManifest(data: SeededData): Promise<void> {
  await mkdir(dirname(SEED_MANIFEST_PATH), { recursive: true });
  await writeFile(
    SEED_MANIFEST_PATH,
    `${JSON.stringify(data, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Reads what the seed created.
 *
 * @returns The seeded contract.
 * @throws {Error} When the manifest is missing or does not match the contract
 *   — both of which mean "the seed project did not run", so the message says
 *   so rather than leaving a spec to fail on an empty key.
 * @example
 * const seeded = await readSeedManifest();
 * await page.goto(`/apps/${seeded.applicationSlug}`);
 */
export async function readSeedManifest(): Promise<SeededData> {
  let raw: string;
  try {
    raw = await readFile(SEED_MANIFEST_PATH, "utf8");
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No seed manifest at ${SEED_MANIFEST_PATH} (${cause}). The "seed" ` +
        "setup project must run before this spec — check the project's " +
        "`dependencies` in playwright.config.ts.",
    );
  }

  const parsed = seededDataSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `The seed manifest at ${SEED_MANIFEST_PATH} does not match the seeded ` +
        "contract, which means it was left behind by an older or interrupted " +
        `run. Delete it and reseed. Issues: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}
