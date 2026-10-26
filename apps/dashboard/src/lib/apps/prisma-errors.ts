import { Prisma } from "@prisma/client";

/**
 * Prisma's known request-error codes, read safely off an `unknown`.
 *
 * The actions translate exactly two data-layer outcomes into form errors — a
 * unique-constraint collision and a row that vanished between the read and
 * the write. Everything else stays an exception for the error boundary, so a
 * real fault is never dressed up as a validation message.
 */

/** A unique constraint was violated, e.g. a slug another application holds. */
export const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

/** The record a write targeted no longer exists. */
export const RECORD_NOT_FOUND = "P2025";

/**
 * Whether an error is Prisma's report of a particular known failure.
 *
 * @param error - Whatever was caught. Untyped by definition.
 * @param code - The Prisma error code to match.
 * @returns True only for a `PrismaClientKnownRequestError` carrying `code`.
 * @example
 * if (isPrismaError(error, UNIQUE_CONSTRAINT_VIOLATION)) return slugTaken();
 */
export function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
