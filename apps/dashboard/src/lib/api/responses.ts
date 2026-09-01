import { NextResponse } from "next/server";

import { type ApiError, type ApiErrorCode } from "./errors";

/**
 * The single response envelope every endpoint in this app answers with.
 *
 * One shape, produced by these helpers only. A handler never hand-builds a
 * body: that is how per-endpoint shapes and accidental field leaks appear.
 */

/** A successful response body. */
export interface ApiSuccessBody<TData> {
  success: true;
  data: TData;
}

/** A failed response body. */
export interface ApiErrorBody {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

/** Either arm of the envelope. */
export type ApiResponseBody<TData> = ApiSuccessBody<TData> | ApiErrorBody;

/** Extra response headers a handler wants merged in (CORS, cache-control). */
export type ExtraHeaders = Readonly<Record<string, string>>;

/**
 * Everything this API returns is per-request and authenticated or
 * credentialled. None of it may sit in a shared cache.
 */
const NO_STORE: ExtraHeaders = { "cache-control": "no-store" };

function withHeaders(extra?: ExtraHeaders): Record<string, string> {
  return { ...NO_STORE, ...extra };
}

/**
 * A success envelope.
 *
 * @param data - The projected payload. Must already be a DTO, never a raw row.
 * @param init - Optional status (defaults to 200) and extra headers.
 */
export function apiSuccess<TData>(
  data: TData,
  init: { status?: number; headers?: ExtraHeaders } = {},
): NextResponse<ApiSuccessBody<TData>> {
  return NextResponse.json(
    { success: true as const, data },
    { status: init.status ?? 200, headers: withHeaders(init.headers) },
  );
}

/**
 * An error envelope built from a typed {@link ApiError}.
 *
 * Only `code`, `message` and `details` cross the boundary — `logContext` and
 * any `cause` stay behind.
 *
 * @param error - The typed error to serialise.
 * @param headers - Extra headers to merge in.
 */
export function apiFailure(
  error: ApiError,
  headers?: ExtraHeaders,
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };

  return NextResponse.json(body, {
    status: error.status,
    headers: withHeaders(headers),
  });
}
