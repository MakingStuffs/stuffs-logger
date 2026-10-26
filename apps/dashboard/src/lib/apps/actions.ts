"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { generateIngestKey } from "@/lib/ingest/keys";
import type { IngestKeyType } from "@/lib/ingest/keys";

import { requireAdminCaller } from "./admin-caller";

/**
 * Ingest-key mutations.
 *
 * A Server Action is a public HTTP endpoint: the fact that only one dialog in
 * this app calls it is a UI detail, not a control. Every action below
 * therefore re-derives the session from the request, re-checks the ADMIN role,
 * and re-validates its input — nothing is trusted because the form that
 * normally submits it happens to be rendered behind a gate.
 *
 * The gate itself lives in `./admin-caller.ts`, shared with the application
 * mutations in `./application-actions.ts`. Reads stay in `lib/apps/queries.ts`
 * and `lib/logs/queries.ts`, where the session is passed in by the page that
 * already gated itself.
 */

/** The two key designs, as a runtime vocabulary for validation. */
const INGEST_KEY_TYPES = [
  "PUBLIC",
  "SECRET",
] as const satisfies readonly IngestKeyType[];

/** Longest label a key may carry. */
const MAX_KEY_NAME_LENGTH = 64;

/** Longest raw origin list accepted from the form, before splitting. */
const MAX_ORIGINS_INPUT_LENGTH = 2_000;

/** Most origins one public key may be bound to. */
const MAX_ALLOWED_ORIGINS = 20;

/** Longest id accepted from a form field. */
const MAX_ID_LENGTH = 64;

/**
 * The outcome of an ingest-key action.
 *
 * One discriminated union for both actions so the calling components handle
 * them identically. `created` is the ONLY shape that ever carries a key's
 * plaintext, and it is never persisted anywhere the UI can read it back.
 */
export type IngestKeyActionResult =
  | { status: "idle" }
  | {
      status: "created";
      keyName: string;
      keyType: IngestKeyType;
      /** Shown once. For a secret key this value is unrecoverable afterwards. */
      plaintext: string;
    }
  | { status: "revoked"; keyName: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[] | undefined>;
    };

const idSchema = z.string().trim().min(1).max(MAX_ID_LENGTH);

const createIngestKeySchema = z.object({
  applicationId: idSchema,
  name: z.string().trim().min(1).max(MAX_KEY_NAME_LENGTH),
  type: z.enum(INGEST_KEY_TYPES),
  allowedOrigins: z.string().max(MAX_ORIGINS_INPUT_LENGTH).optional(),
});

const revokeIngestKeySchema = z.object({
  keyId: idSchema,
  /**
   * The key's own name, retyped by the operator.
   *
   * An intent signal, not an identity one. A valid session already proves who
   * is calling; it does not prove they meant to break a live application's
   * logging, and same-origin script running under that session would pass every
   * framework CSRF check. Something only a human looking at the row can supply
   * is what separates the two.
   */
  confirmName: z
    .string()
    .trim()
    .min(1, "Type the key's name exactly.")
    .max(MAX_KEY_NAME_LENGTH, "Type the key's name exactly."),
});

/**
 * Splits the origin textarea into distinct entries.
 *
 * Accepts newlines or commas because both are what people paste.
 */
function splitOrigins(raw: string): string[] {
  const entries = raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [...new Set(entries)];
}

/**
 * Whether a string is an exact origin and nothing more.
 *
 * The ingest endpoint compares the request's `Origin` header byte-for-byte
 * against this list, so an entry carrying a path, a trailing slash or
 * credentials would silently never match. Rejecting it here means a
 * misconfiguration is a form error rather than an application that mysteriously
 * cannot log.
 */
function isExactOrigin(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  return parsed.origin === value;
}

/** Validates the origin list against the key class it is being attached to. */
function validateOrigins(
  type: IngestKeyType,
  origins: string[],
): string[] | null {
  if (type === "SECRET") {
    return origins.length === 0
      ? null
      : ["A secret key is not bound to origins, so leave this empty."];
  }

  if (origins.length === 0) {
    return [
      "A public key needs at least one allowed origin — it is the only thing protecting it.",
    ];
  }
  if (origins.length > MAX_ALLOWED_ORIGINS) {
    return [`List at most ${MAX_ALLOWED_ORIGINS} origins.`];
  }

  const invalid = origins.filter((origin) => !isExactOrigin(origin));
  if (invalid.length > 0) {
    return [
      `Not an exact origin: ${invalid.join(", ")}. Use the scheme, host and port only, e.g. https://app.example.com`,
    ];
  }

  return null;
}

/**
 * Creates an ingest key for an application.
 *
 * The plaintext is returned once, in this result, and never again: for a
 * secret key only a SHA-256 digest of its secret segment is persisted, so
 * there is nothing left to read back. That property comes from
 * {@link generateIngestKey}, which is the only place in the codebase that
 * mints a key or hashes a secret — this action deliberately does neither
 * itself.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param formData - The submitted form. Entirely untrusted.
 * @returns The created key's plaintext, or a typed failure.
 */
export async function createIngestKeyAction(
  _previous: IngestKeyActionResult,
  formData: FormData,
): Promise<IngestKeyActionResult> {
  const caller = await requireAdminCaller();
  if (!caller.ok) return caller.refusal;

  const parsed = createIngestKeySchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the details and try again.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const origins = splitOrigins(parsed.data.allowedOrigins ?? "");
  const originErrors = validateOrigins(parsed.data.type, origins);
  if (originErrors !== null) {
    return {
      status: "error",
      message: "Check the allowed origins and try again.",
      fieldErrors: { allowedOrigins: originErrors },
    };
  }

  const application = await prisma.application.findUnique({
    where: { id: parsed.data.applicationId },
    select: { id: true, slug: true },
  });
  if (application === null) {
    return { status: "error", message: "That application no longer exists." };
  }

  const generated = generateIngestKey(parsed.data.type);

  await prisma.ingestKey.create({
    data: {
      applicationId: application.id,
      name: parsed.data.name,
      type: parsed.data.type,
      publicKey: generated.publicKey,
      keyId: generated.keyId,
      secretHash: generated.secretHash,
      allowedOrigins: parsed.data.type === "PUBLIC" ? origins : [],
    },
    select: { id: true },
  });

  revalidatePath(`/apps/${application.slug}`);

  return {
    status: "created",
    keyName: parsed.data.name,
    keyType: parsed.data.type,
    plaintext: generated.plaintext,
  };
}

/**
 * Revokes an ingest key.
 *
 * Revoked rather than deleted, so the row that recorded which application a
 * credential belonged to survives the revocation.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param formData - The submitted form, including the retyped key name.
 * @returns Confirmation, or a typed failure.
 */
export async function revokeIngestKeyAction(
  _previous: IngestKeyActionResult,
  formData: FormData,
): Promise<IngestKeyActionResult> {
  const caller = await requireAdminCaller();
  if (!caller.ok) return caller.refusal;

  const parsed = revokeIngestKeySchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return {
      status: "error",
      message: "Type the key's name to confirm.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const key = await prisma.ingestKey.findUnique({
    where: { id: parsed.data.keyId },
    select: {
      id: true,
      name: true,
      revokedAt: true,
      application: { select: { slug: true } },
    },
  });
  if (key === null) {
    return { status: "error", message: "That key no longer exists." };
  }
  if (key.revokedAt !== null) {
    return { status: "error", message: "That key is already revoked." };
  }
  if (key.name !== parsed.data.confirmName) {
    return {
      status: "error",
      message: "The name you typed does not match this key.",
      fieldErrors: { confirmName: ["Type the key's name exactly."] },
    };
  }

  await prisma.ingestKey.update({
    where: { id: key.id },
    data: { revokedAt: new Date() },
    select: { id: true },
  });

  revalidatePath(`/apps/${key.application.slug}`);

  return { status: "revoked", keyName: key.name };
}
