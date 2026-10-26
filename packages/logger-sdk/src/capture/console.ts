import type { LogLevel } from "../contract";
import {
  CONSOLE_METHODS,
  consoleHost,
  originalConsole,
} from "../logger/original-console";
import type { ConsoleMethod, ConsoleWriter } from "../logger/original-console";
import type { Logger, LogContext } from "../types";

/**
 * Replacing `console.*` with itself, plus a log event.
 *
 * The point of the SDK is that an application does not have to be rewritten to
 * use it, so the patched methods are drop-in: they call the real console FIRST
 * — before anything of ours runs, so the developer's own output is never
 * contingent on the SDK working — and only then hand a copy to the logger.
 *
 * Patching a global is a shared resource, so this module owns exactly one
 * patch at a time: a second `captureConsole()` call returns the first
 * disposer instead of wrapping the wrapper, and a disposer only restores a
 * method it can still see its own function on, leaving anyone who patched
 * after us alone.
 */

/** Marks a function as this SDK's console patch. */
const PATCH_MARKER = "__jfLoggerConsolePatch";

/** How each console method maps onto a severity. */
export const DEFAULT_CONSOLE_LEVELS: Readonly<Record<ConsoleMethod, LogLevel>> =
  {
    log: "info",
    info: "info",
    warn: "warn",
    error: "error",
    debug: "debug",
    trace: "trace",
  };

/** Tuning for {@link captureConsole}. */
export interface ConsoleCaptureOptions {
  /** Which methods to patch. Defaults to all six. */
  methods?: readonly ConsoleMethod[];
  /** Per-method severity overrides. */
  levels?: Partial<Record<ConsoleMethod, LogLevel>>;
}

/** Undoes a `captureConsole()` call. Safe to call more than once. */
export type RestoreConsole = () => void;

const noRestore: RestoreConsole = () => {};

let activeRestore: RestoreConsole | undefined;

function isOurPatch(candidate: unknown): boolean {
  return typeof candidate === "function" && PATCH_MARKER in candidate;
}

/**
 * Only names from the SDK's own list are patched. A caller-supplied name such
 * as `"constructor"` or `"toString"` would otherwise be looked up on the
 * console snapshot, found on its prototype, found to be a function — and
 * wrapped.
 */
function isConsoleMethod(candidate: unknown): candidate is ConsoleMethod {
  return CONSOLE_METHODS.includes(candidate as ConsoleMethod);
}

function mark(patched: ConsoleWriter): ConsoleWriter {
  Object.defineProperty(patched, PATCH_MARKER, { value: true });
  return patched;
}

/**
 * Splits console arguments into a message, an error and the remainder.
 *
 * Mirrors how the arguments read on screen: the first is the message (an
 * `Error` there contributes its own message), any `Error` anywhere in the call
 * becomes the structured error, and everything after the first argument is
 * kept as context so nothing a developer passed is silently lost.
 */
function describeArguments(args: readonly unknown[]): {
  message: unknown;
  context?: LogContext;
  error?: unknown;
} {
  const [first, ...rest] = args;
  const error = args.find((argument) => argument instanceof Error);

  return {
    message: first,
    ...(rest.length > 0 && { context: { arguments: rest } }),
    ...(error !== undefined && { error }),
  };
}

/**
 * Forwards `console` output to a logger without changing what the console
 * does.
 *
 * @param logger - Where captured calls are sent.
 * @param options - Which methods to patch and how to grade them.
 * @returns A disposer restoring the original methods. Calling `captureConsole`
 *   again while a patch is installed returns that same disposer rather than
 *   patching twice.
 * @example
 * const restore = captureConsole(logger);
 * console.warn("slow query", { ms: 900 }); // still prints, now also logged
 * restore();
 */
export function captureConsole(
  logger: Logger,
  options: ConsoleCaptureOptions = {},
): RestoreConsole {
  if (activeRestore) return activeRestore;

  const host = consoleHost();
  if (!host) return noRestore;

  const methods = (options.methods ?? CONSOLE_METHODS).filter(isConsoleMethod);
  const levels = { ...DEFAULT_CONSOLE_LEVELS, ...options.levels };
  const installed: Partial<Record<ConsoleMethod, ConsoleWriter>> = {};

  for (const method of methods) {
    const original = originalConsole[method];
    if (!original || isOurPatch(host[method])) continue;

    const level = levels[method];

    const patched = mark((...args: unknown[]): void => {
      original.apply(host, args);
      logger.capture({
        level,
        logger: "console",
        ...describeArguments(args),
      });
    });

    try {
      host[method] = patched;
    } catch {
      // A frozen or sealed console refuses the assignment (every build of
      // this package is strict-mode code, so it throws rather than failing
      // silently). That method goes uncaptured, which beats throwing out of
      // the call an application made to make itself MORE observable.
      continue;
    }
    installed[method] = patched;
  }

  const restore: RestoreConsole = () => {
    for (const method of CONSOLE_METHODS) {
      const patched = installed[method];
      if (patched && host[method] === patched) {
        host[method] = originalConsole[method];
      }
    }
    if (activeRestore === restore) activeRestore = undefined;
  };

  activeRestore = restore;
  return restore;
}
