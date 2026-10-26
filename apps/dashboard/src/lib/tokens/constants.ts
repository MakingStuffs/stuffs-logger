/**
 * API-token limits shared by the action that enforces them and the form that
 * mirrors them. Browser-safe: no imports.
 */

/** Longest label a token may carry. */
export const MAX_API_TOKEN_NAME_LENGTH = 64;

/** The page tokens are managed on, revalidated after every mutation. */
export const API_TOKENS_PATH = "/tokens";
