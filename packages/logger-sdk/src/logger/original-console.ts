/**
 * A snapshot of the console taken at module load — before any patching, this
 * package's or anyone else's, has had a chance to run.
 *
 * Two consumers need it and both need it to be the REAL console:
 * `captureConsole` restores from it and forwards through it, and the SDK's own
 * diagnostics write to it. Reading `console.error` lazily would find the
 * patched function and close the feedback loop that `./suppression` exists to
 * open.
 *
 * The functions are stored UNBOUND. Restoring a console must put back the
 * exact function that was there, not a bound copy of it — anything else leaves
 * the host's console subtly different from how the SDK found it.
 */

/** The console methods this SDK knows how to capture. */
export const CONSOLE_METHODS = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
] as const;

/** One capturable console method name. */
export type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

/** The signature every capturable console method shares. */
export type ConsoleWriter = (...args: unknown[]) => void;

/** The console object, typed to the methods this SDK touches. */
export type ConsoleLike = Partial<Record<ConsoleMethod, ConsoleWriter>>;

/**
 * The host console, or `undefined` where there is none.
 *
 * @returns The console object.
 */
export function consoleHost(): ConsoleLike | undefined {
  const host: unknown = globalThis.console;
  if (typeof host !== "object" || host === null) return undefined;
  return host as ConsoleLike;
}

function snapshot(): ConsoleLike {
  const host = consoleHost();
  const target: ConsoleLike = {};
  if (!host) return target;

  for (const method of CONSOLE_METHODS) {
    const candidate = host[method];
    if (typeof candidate === "function") target[method] = candidate;
  }

  return target;
}

/** The unpatched console methods, exactly as they were found. */
export const originalConsole: Readonly<ConsoleLike> = snapshot();
