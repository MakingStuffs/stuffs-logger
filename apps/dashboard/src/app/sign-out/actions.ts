"use server";

import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/lib/auth/return-path";
import { signOut } from "@/lib/auth/session";

/**
 * The sign-out mutation.
 *
 * A SERVER ACTION SUBMITTED BY A REAL FORM, never a link. Signing out changes
 * state, so it has to be a POST: a `GET /sign-out` can be triggered by an
 * image tag in an email, and a prefetch would end the session of anyone who
 * merely hovered the control.
 *
 * It takes no arguments, and that is the security property: the session being
 * revoked is read from the request's own cookie inside {@link signOut}, so
 * there is nothing a caller could tamper with to sign out somebody else.
 *
 * `redirect` signals by THROWING, so it sits outside any `try`. `signOut`
 * never throws, so there is no `try` here at all.
 */
export async function signOutAction(): Promise<void> {
  await signOut();

  redirect(SIGN_IN_PATH);
}
