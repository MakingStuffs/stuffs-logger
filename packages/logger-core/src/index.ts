/**
 * `@jf-logger/core` — the single source of truth for the jf-logger wire
 * contract.
 *
 * Imported by BOTH the SDK and the dashboard so the limits the client enforces
 * and the limits the server rejects on can never drift apart. Everything here
 * is pure and runtime-agnostic: no Node built-ins, no DOM, no database.
 */

export * from "./constants";
export * from "./taxonomy";
export * from "./json";
export * from "./keys";
export * from "./redaction";
export * from "./schemas";
export * from "./text";
export * from "./timestamps";
