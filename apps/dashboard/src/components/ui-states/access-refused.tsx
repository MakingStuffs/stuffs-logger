import { ShieldAlert, UserX } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ApiErrorCode } from "@/lib/api/errors";
import { isApiError } from "@/lib/api/errors";

import { EmptyState } from "./empty-state";

/**
 * Turning the data layer's refusal into a designed page state.
 *
 * Every read in this app is gated on `assertInternalViewer` and THROWS for a
 * caller who is signed in but is not Journey Further staff. That is the right
 * shape for a data-access function — quietly returning nothing would read as
 * "there are no logs" — but on a page it is an outcome to render, not a fault:
 * letting it reach `error.tsx` would tell a colleague that JF Logger is broken
 * when it is working exactly as designed.
 */

/** The refusals a page renders rather than throwing. */
const REFUSAL_CODES = [
  "FORBIDDEN",
  "UNAUTHORIZED",
] as const satisfies readonly ApiErrorCode[];

/** A refusal a page knows how to show. */
export type AccessRefusalCode = (typeof REFUSAL_CODES)[number];

/** What a gated read produced: the data, or the reason it was refused. */
export type AccessOutcome<T> =
  { allowed: true; data: T } | { allowed: false; code: AccessRefusalCode };

function isRefusalCode(code: ApiErrorCode): code is AccessRefusalCode {
  return REFUSAL_CODES.some((refusal) => refusal === code);
}

/**
 * Runs a gated read, catching only the two refusals a page can render.
 *
 * Everything else — a database failure, a `notFound()`, a bug — is rethrown
 * untouched, so the error boundary keeps the cases it exists for.
 *
 * @param load - The read (or reads) to run, already bound to a session.
 * @returns The loaded data, or the refusal code to render.
 * @example
 * const outcome = await resolveAccess(() => listApplications(session));
 * if (!outcome.allowed) return <AccessRefused code={outcome.code} />;
 */
export async function resolveAccess<T>(
  load: () => Promise<T>,
): Promise<AccessOutcome<T>> {
  try {
    return { allowed: true, data: await load() };
  } catch (error) {
    if (isApiError(error) && isRefusalCode(error.code)) {
      return { allowed: false, code: error.code };
    }
    throw error;
  }
}

interface RefusalCopy {
  icon: LucideIcon;
  title: string;
  description: string;
}

/**
 * Written for the person reading it, not from the thrown message: a refusal
 * has to say why the tool is closed and what to do about it, and the data
 * layer's message is a one-liner for an API client.
 */
const REFUSAL_COPY: Readonly<Record<AccessRefusalCode, RefusalCopy>> = {
  FORBIDDEN: {
    icon: ShieldAlert,
    title: "Journey Further staff only",
    description:
      "JF Logger is an internal engineering tool. A log line carries whatever an application logged — request paths, identifiers, error payloads — and ingest keys are write credentials on top of that, so only Journey Further staff can read them. Nothing has gone wrong; if you think your account should have access, ask whoever runs JF Logger to check its scope.",
  },
  UNAUTHORIZED: {
    icon: UserX,
    title: "Your account is no longer active",
    description:
      "This account has been deactivated, so it can no longer read anything in JF Logger. Sign in again with an active account, or ask whoever runs JF Logger to reactivate this one.",
  },
};

/**
 * The refusal state: why this surface is closed, and what to do next.
 *
 * @param code - The refusal from {@link resolveAccess}.
 */
export function AccessRefused({ code }: { code: AccessRefusalCode }) {
  const copy = REFUSAL_COPY[code];

  return (
    <EmptyState
      icon={copy.icon}
      title={copy.title}
      description={copy.description}
    />
  );
}
