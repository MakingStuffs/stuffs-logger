/**
 * The one error type every surface in this app throws, and the one code
 * vocabulary every client switches on.
 */

/** The stable, machine-readable error codes this API answers with. */
export const API_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "VALIDATION_FAILED",
  "INVALID_INPUT",
  "RESOURCE_NOT_FOUND",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

/** A single error code. */
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** The HTTP status each code is answered with. */
const STATUS_BY_CODE: Readonly<Record<ApiErrorCode, number>> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  VALIDATION_FAILED: 400,
  INVALID_INPUT: 400,
  RESOURCE_NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * A failure with a client-facing code and message, and optionally some
 * server-only context.
 *
 * The split between `message` and `logContext` is the whole point of the
 * class: `message` is written for the caller and is safe to return, while
 * `logContext` holds the diagnosis — which check failed, which key, which
 * origin — and never leaves the server logs.
 */
export class ApiError extends Error {
  /** The stable code the client switches on. */
  readonly code: ApiErrorCode;
  /** The HTTP status, derived from the code so the two cannot disagree. */
  readonly status: number;
  /** Optional structured context safe to return (e.g. field-level issues). */
  readonly details?: unknown;
  /** Server-only diagnosis. NEVER serialised into a response. */
  readonly logContext?: string;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { details?: unknown; logContext?: string; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (options.details !== undefined) this.details = options.details;
    if (options.logContext !== undefined) this.logContext = options.logContext;
  }
}

/**
 * Narrows an unknown caught value to an {@link ApiError}.
 *
 * @param error - The caught value.
 * @returns Whether it is one of ours.
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
