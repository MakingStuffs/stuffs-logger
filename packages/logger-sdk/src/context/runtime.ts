import type { LogSource } from "../contract";

/**
 * Runtime detection and typed access to host globals.
 *
 * The SDK ships into Node, browsers, edge workers and bundlers that inline all
 * three, so nothing here may statically import a host module. `process` is
 * read off `globalThis` behind a hand-written structural type rather than
 * `@types/node` — that keeps the package free of a types dependency it would
 * otherwise force on every consumer, and keeps the browser bundle free of the
 * shims a bundler adds the moment it sees a `node:` specifier.
 */

/** The slice of Node's `process` the SDK actually touches. */
export interface ProcessLike {
  pid?: number;
  version?: string;
  platform?: string;
  env?: Record<string, string | undefined>;
  on?: (event: string, listener: (...args: never[]) => void) => unknown;
  off?: (event: string, listener: (...args: never[]) => void) => unknown;
  listeners?: (event: string) => readonly unknown[];
}

/** Node's `process`, or `undefined` outside Node. */
export function getProcess(): ProcessLike | undefined {
  const candidate = (globalThis as { process?: unknown }).process;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  return candidate as ProcessLike;
}

/** Reads an environment variable, or `undefined` where there is no environment. */
export function readEnv(name: string): string | undefined {
  const value = getProcess()?.env?.[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Whether a DOM is present. */
export function isBrowserRuntime(): boolean {
  return (
    typeof window !== "undefined" && typeof window.document !== "undefined"
  );
}

/**
 * The `source` the current runtime reports to the ingest endpoint.
 *
 * @returns `"browser"` when a DOM is present, otherwise `"node"`.
 */
export function detectSource(): LogSource {
  return isBrowserRuntime() ? "browser" : "node";
}
