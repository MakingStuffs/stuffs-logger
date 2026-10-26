"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { generateApiToken } from "@/lib/auth/api-token";
import { prisma } from "@/lib/db";

import type { ApiTokenActionResult } from "./action-result";
import { checkAdminCaller } from "./admin-caller";
import { API_TOKENS_PATH, MAX_API_TOKEN_NAME_LENGTH } from "./constants";
import { formFields } from "./form-fields";

/**
 * API-token mutations: minting and revoking.
 *
 * Each action re-derives the session, re-checks the ADMIN role and
 * re-validates its input against a strict schema — nothing is trusted because
 * the dialog that normally submits it sits behind a gated page. The raw token
 * exists only in the `created` result; it is never stored and never logged.
 */

/** Longest id accepted from a form field. */
const MAX_ID_LENGTH = 64;

const tokenNameSchema = z.string().trim().min(1).max(MAX_API_TOKEN_NAME_LENGTH);

const createApiTokenSchema = z.strictObject({ name: tokenNameSchema });

const revokeApiTokenSchema = z.strictObject({
  tokenId: z.string().trim().min(1).max(MAX_ID_LENGTH),
  /**
   * The token's own name, retyped by the operator. An INTENT signal: a valid
   * session proves who is calling, not that they meant to break the retention
   * job, and a script on this origin would pass every framework CSRF check.
   */
  confirmName: z
    .string()
    .trim()
    .min(1, "Type the token's name exactly.")
    .max(MAX_API_TOKEN_NAME_LENGTH, "Type the token's name exactly."),
});

/**
 * Mints an API token and returns its raw value, once.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param formData - The submitted form. Entirely untrusted.
 * @returns The raw token, or a typed failure.
 */
export async function createApiTokenAction(
  _previous: ApiTokenActionResult,
  formData: FormData,
): Promise<ApiTokenActionResult> {
  const caller = await checkAdminCaller();
  if (!caller.ok) return { status: "error", message: caller.message };

  const parsed = createApiTokenSchema.safeParse(formFields(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the details and try again.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const { raw, tokenHash } = generateApiToken();

  await prisma.apiToken.create({
    data: { name: parsed.data.name, tokenHash },
    select: { id: true },
  });

  revalidatePath(API_TOKENS_PATH);

  return { status: "created", tokenName: parsed.data.name, token: raw };
}

/**
 * Revokes an API token. Revoked rather than deleted, so the row recording
 * that the credential existed survives.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param formData - The submitted form, including the retyped token name.
 * @returns Confirmation, or a typed failure.
 */
export async function revokeApiTokenAction(
  _previous: ApiTokenActionResult,
  formData: FormData,
): Promise<ApiTokenActionResult> {
  const caller = await checkAdminCaller();
  if (!caller.ok) return { status: "error", message: caller.message };

  const parsed = revokeApiTokenSchema.safeParse(formFields(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Type the token's name to confirm.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const token = await prisma.apiToken.findUnique({
    where: { id: parsed.data.tokenId },
    select: { id: true, name: true, revokedAt: true },
  });
  if (token === null) {
    return { status: "error", message: "That token no longer exists." };
  }
  if (token.revokedAt !== null) {
    return { status: "error", message: "That token is already revoked." };
  }
  if (token.name !== parsed.data.confirmName) {
    return {
      status: "error",
      message: "The name you typed does not match this token.",
      fieldErrors: { confirmName: ["Type the token's name exactly."] },
    };
  }

  // `revokedAt: null` in the filter so a concurrent revocation is a no-op
  // rather than a second stamp overwriting the first.
  await prisma.apiToken.updateMany({
    where: { id: token.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  revalidatePath(API_TOKENS_PATH);

  return { status: "revoked", tokenName: token.name };
}
