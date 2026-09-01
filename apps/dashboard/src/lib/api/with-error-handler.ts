import type { NextResponse } from "next/server";

import { ApiError, isApiError } from "./errors";
import { apiFailure, type ExtraHeaders } from "./responses";

/**
 * The single catch every route handler runs through.
 *
 * Handlers throw typed {@link ApiError}s and write only the happy path; this
 * wrapper turns them into the envelope. Anything it does NOT recognise is a
 * bug, and becomes one fixed 500 with the real error logged — so an unexpected
 * failure can never hand a caller a stack trace, a Prisma constraint name, or
 * a connection string.
 */

/** Builds the headers to attach to a failure — CORS must survive an error. */
export type ErrorHeaderBuilder = (request: Request) => ExtraHeaders | undefined;

interface WithErrorHandlerOptions {
  /** Label for the server log, e.g. `ingest.post`. Never sent to the client. */
  context: string;
  /**
   * Headers to attach to failure responses. CORS headers in particular MUST be
   * present on refusals, or the browser reports an opaque network error
   * instead of the 401 the endpoint actually sent.
   */
  errorHeaders?: ErrorHeaderBuilder;
}

/**
 * Wraps a route handler so every thrown error becomes the standard envelope.
 *
 * @param options - The log context and optional failure-header builder.
 * @param handler - The handler, free to throw typed errors.
 * @returns A handler that never throws.
 * @example
 * export const POST = withErrorHandler({ context: "ingest.post" }, async (req) => {
 *   const body = await readBody(req);
 *   return apiSuccess(await ingest(body), { status: 202 });
 * });
 */
export function withErrorHandler<TArgs extends unknown[]>(
  options: WithErrorHandlerOptions,
  handler: (request: Request, ...args: TArgs) => Promise<NextResponse>,
): (request: Request, ...args: TArgs) => Promise<NextResponse> {
  return async (request, ...args) => {
    const headers = () => options.errorHeaders?.(request);

    try {
      return await handler(request, ...args);
    } catch (error) {
      if (isApiError(error)) {
        if (error.logContext) {
          console.warn(
            `[${options.context}] refused (${error.code}): ${error.logContext}`,
          );
        }
        return apiFailure(error, headers());
      }

      console.error(`[${options.context}] unhandled failure:`, error);
      return apiFailure(
        new ApiError("INTERNAL_ERROR", "An unexpected error occurred."),
        headers(),
      );
    }
  };
}
