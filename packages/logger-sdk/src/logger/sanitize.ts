import {
  jsonByteLength,
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_DEPTH,
  MAX_ERROR_NAME_LENGTH,
  MAX_ERROR_STACK_LENGTH,
  MAX_MESSAGE_LENGTH,
} from "../contract";
import type { JsonValue, LogErrorPayload } from "../contract";
import {
  CIRCULAR_MARKER,
  EMPTY_MESSAGE_PLACEHOLDER,
  MAX_CONTEXT_NODES,
  TRUNCATION_MARKER,
} from "../defaults";
import type { JsonObject } from "../types";
import type { Redactor } from "./redact";

/**
 * Turning arbitrary caller values into something the wire contract accepts.
 *
 * Callers pass whatever they were holding: DOM nodes, class instances,
 * circular graphs, `BigInt`s, objects whose getters throw. None of that
 * survives `JSON.stringify`, and a logger that throws on a value someone tried
 * to log has failed at its only job.
 *
 * Every function here is total — it returns a value for every input, never
 * throws, and never runs unbounded. The budgets are enforced DURING the walk
 * rather than by serializing and measuring afterwards, because the walk is on
 * the caller's hot path and a rejected 10 MB object must cost the budget, not
 * the object.
 */

/**
 * Punctuation charged per container entry: two quotes around the key, a
 * colon, a comma and the two quotes a string value will need.
 */
const STRUCTURAL_COST = 6;

/** Headroom reserved for the outermost braces and rounding. */
const STRUCTURAL_HEADROOM = 8;

/**
 * Worst-case UTF-8 bytes per UTF-16 code unit.
 *
 * The walk budgets in code units because counting them is free; the contract
 * bounds bytes. Below this ratio the two cannot disagree, so the exact check
 * is only paid for by a caller who is genuinely near the limit.
 */
const MAX_BYTES_PER_UNIT = 3;

/** Flat cost charged for a non-string scalar, in place of measuring it. */
const SCALAR_COST = 8;

interface WalkBudget {
  chars: number;
  nodes: number;
}

/**
 * Truncates a string to a maximum length, marking the cut.
 *
 * @param value - The string to bound.
 * @param maxLength - The inclusive maximum length of the result.
 * @returns The original string, or a truncated one ending in a marker.
 */
export function clampString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= TRUNCATION_MARKER.length) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

function isErrorLike(
  value: unknown,
): value is { name?: unknown; message?: unknown; stack?: unknown } {
  if (value instanceof Error) return true;
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    "stack" in value
  );
}

function readProperty(source: object, key: string): unknown {
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    // A throwing getter is the property's problem, not the logger's.
    return TRUNCATION_MARKER;
  }
}

function stringifyScalar(value: unknown): string {
  try {
    return String(value);
  } catch {
    return TRUNCATION_MARKER;
  }
}

/**
 * Renders any value as a bounded, non-empty log message.
 *
 * @param value - Whatever the caller passed as the message.
 * @returns A string of at most `MAX_MESSAGE_LENGTH` characters.
 * @example
 * toMessage(new Error("boom")); // "boom"
 */
export function toMessage(value: unknown): string {
  if (typeof value === "string") return finalizeMessage(value);
  if (isErrorLike(value)) {
    const message = value.message;
    if (typeof message === "string") return finalizeMessage(message);
  }
  if (value === null || value === undefined) {
    return EMPTY_MESSAGE_PLACEHOLDER;
  }
  if (typeof value === "object") {
    try {
      const serialized = JSON.stringify(value);
      if (typeof serialized === "string") return finalizeMessage(serialized);
    } catch {
      // Circular or otherwise unserializable — fall through to `String`.
    }
  }
  return finalizeMessage(stringifyScalar(value));
}

function finalizeMessage(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return EMPTY_MESSAGE_PLACEHOLDER;
  return clampString(trimmed, MAX_MESSAGE_LENGTH);
}

/**
 * Converts a thrown value into the wire contract's error shape.
 *
 * @param value - The caught value, which is very often not an `Error`.
 * @returns The payload, or `undefined` when there was nothing to report.
 * @example
 * serializeError("nope"); // { name: "UnknownError", message: "nope" }
 */
export function serializeError(value: unknown): LogErrorPayload | undefined {
  if (value === null || value === undefined) return undefined;

  if (!isErrorLike(value)) {
    return { name: "UnknownError", message: toMessage(value) };
  }

  const name =
    typeof value.name === "string"
      ? clampString(value.name, MAX_ERROR_NAME_LENGTH)
      : "Error";
  const message =
    typeof value.message === "string"
      ? clampString(value.message, MAX_MESSAGE_LENGTH)
      : undefined;
  const stack =
    typeof value.stack === "string"
      ? clampString(value.stack, MAX_ERROR_STACK_LENGTH)
      : undefined;

  return {
    name,
    ...(message !== undefined && { message }),
    ...(stack !== undefined && { stack }),
  };
}

function walk(
  value: unknown,
  depth: number,
  budget: WalkBudget,
  seen: Set<object>,
  redactor: Redactor | undefined,
): JsonValue {
  budget.nodes -= 1;
  if (budget.nodes < 0 || budget.chars <= 0) return TRUNCATION_MARKER;

  if (value === null) return null;

  switch (typeof value) {
    case "boolean":
      budget.chars -= SCALAR_COST;
      return value;
    case "number":
      budget.chars -= SCALAR_COST;
      return Number.isFinite(value) ? value : stringifyScalar(value);
    case "bigint":
      return clampBudgetedString(stringifyScalar(value), budget);
    case "string":
      return clampBudgetedString(value, budget);
    case "function":
      return "[function]";
    case "symbol":
      return "[symbol]";
    case "undefined":
      return null;
    default:
      break;
  }

  const container = value as object;
  if (seen.has(container)) return CIRCULAR_MARKER;
  if (depth >= MAX_CONTEXT_DEPTH) return TRUNCATION_MARKER;

  if (container instanceof Date) {
    const iso = safeIsoString(container);
    return iso === undefined ? TRUNCATION_MARKER : iso;
  }
  if (isErrorLike(container)) {
    const serialized = serializeError(container);
    return serialized === undefined ? TRUNCATION_MARKER : { ...serialized };
  }

  seen.add(container);
  try {
    if (Array.isArray(container)) {
      return walkArray(container, depth, budget, seen, redactor);
    }
    return walkObject(container, depth, budget, seen, redactor);
  } finally {
    seen.delete(container);
  }
}

function safeIsoString(value: Date): string | undefined {
  try {
    return value.toISOString();
  } catch {
    // An invalid Date throws on `toISOString`.
    return undefined;
  }
}

function clampBudgetedString(value: string, budget: WalkBudget): string {
  const clamped = clampString(value, Math.max(0, budget.chars));
  budget.chars -= clamped.length + STRUCTURAL_COST;
  return clamped;
}

function walkArray(
  source: readonly unknown[],
  depth: number,
  budget: WalkBudget,
  seen: Set<object>,
  redactor: Redactor | undefined,
): JsonValue[] {
  const result: JsonValue[] = [];

  for (const entry of source) {
    if (budget.chars <= 0 || budget.nodes < 0) {
      result.push(TRUNCATION_MARKER);
      break;
    }
    result.push(walk(entry, depth + 1, budget, seen, redactor));
  }

  return result;
}

function walkObject(
  source: object,
  depth: number,
  budget: WalkBudget,
  seen: Set<object>,
  redactor: Redactor | undefined,
): JsonObject {
  const result: JsonObject = {};
  let keys: string[];

  try {
    keys = Object.keys(source);
  } catch {
    // Exotic proxies can refuse enumeration.
    return { [TRUNCATION_MARKER]: true };
  }

  for (const key of keys) {
    if (budget.chars <= 0 || budget.nodes < 0) {
      result[TRUNCATION_MARKER] = true;
      break;
    }

    budget.chars -= key.length + STRUCTURAL_COST;

    if (redactor?.shouldRedact(key)) {
      result[key] = redactor.replacement;
      continue;
    }

    const entry = readProperty(source, key);
    if (entry === undefined) continue;
    result[key] = walk(entry, depth + 1, budget, seen, redactor);
  }

  return result;
}

/**
 * Normalizes a caller's context bag into a bounded, redacted JSON object.
 *
 * @param value - The caller's context, of any shape.
 * @param redactor - Applied to every key; `undefined` disables redaction.
 * @returns A JSON object within the contract's depth and size limits, or
 *   `undefined` when there was nothing worth sending.
 * @example
 * normalizeContext({ user: "ada", token: "t" }, redactor);
 * // { user: "ada", token: "[redacted]" }
 */
export function normalizeContext(
  value: unknown,
  redactor: Redactor | undefined,
): JsonObject | undefined {
  if (value === null || typeof value !== "object") return undefined;

  const budget: WalkBudget = {
    chars: MAX_CONTEXT_BYTES - STRUCTURAL_HEADROOM,
    nodes: MAX_CONTEXT_NODES,
  };

  const normalized = walk(value, 0, budget, new Set<object>(), redactor);
  if (typeof normalized !== "object" || normalized === null) return undefined;

  const result = Array.isArray(normalized) ? { value: normalized } : normalized;
  if (Object.keys(result).length === 0) return undefined;

  const unitsUsed = MAX_CONTEXT_BYTES - budget.chars;
  if (
    unitsUsed > MAX_CONTEXT_BYTES / MAX_BYTES_PER_UNIT &&
    jsonByteLength(result) > MAX_CONTEXT_BYTES
  ) {
    // Multi-byte text spent more bytes than code units. Dropping the bag is
    // better than shipping one the server will refuse.
    return { [TRUNCATION_MARKER]: true };
  }

  return result;
}

/**
 * Merges context layers, most specific last.
 *
 * Each layer was budgeted against the FULL context limit on its own, so a
 * large `setContext` plus a large per-call bag can merge into an object the
 * server refuses — invisibly, because the SDK does not read the ingest
 * response. The merged result is therefore re-measured, and trimmed when it
 * does not fit.
 *
 * @param layers - Already-normalized objects, least specific first.
 * @returns The merged object, within the contract's byte limit, or `undefined`
 *   when every layer was empty.
 * @example
 * mergeContext({ a: 1, b: 1 }, { b: 2 }); // { a: 1, b: 2 }
 */
export function mergeContext(
  ...layers: readonly (JsonObject | undefined)[]
): JsonObject | undefined {
  let merged: JsonObject | undefined;

  for (const layer of layers) {
    if (!layer) continue;
    merged = merged ? { ...merged, ...layer } : layer;
  }

  if (merged === undefined) return undefined;
  if (jsonByteLength(merged) <= MAX_CONTEXT_BYTES) return merged;

  return mergeWithinBudget(layers);
}

/**
 * Re-merges layers most-specific-first, stopping at the byte limit.
 *
 * The specific layer wins the budget as well as the key: a per-call bag is the
 * reason this event was logged, while the collected and static layers repeat
 * on every event.
 */
function mergeWithinBudget(
  layers: readonly (JsonObject | undefined)[],
): JsonObject {
  const result: JsonObject = {};
  const seen = new Set<string>();
  let used = STRUCTURAL_HEADROOM + TRUNCATION_MARKER.length + STRUCTURAL_COST;
  let truncated = false;

  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (!layer) continue;

    for (const [key, value] of Object.entries(layer)) {
      if (seen.has(key)) continue;
      seen.add(key);

      const cost =
        jsonByteLength(value) + jsonByteLength(key) + STRUCTURAL_COST;
      if (used + cost > MAX_CONTEXT_BYTES) {
        truncated = true;
        continue;
      }

      used += cost;
      result[key] = value;
    }
  }

  if (truncated) result[TRUNCATION_MARKER] = true;
  return result;
}
