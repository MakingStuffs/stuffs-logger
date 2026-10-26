import { jsonByteLength } from "@stuffs/logger-core";

/**
 * Bounding the heavy columns in the LIST projection.
 *
 * The stream query pays for `context` and `errorStack` whether or not it
 * returns them — they are columns on rows it is already reading — so throwing
 * them away to derive a boolean bought nothing and cost the expanded row a
 * second round trip. They are returned instead, bounded.
 *
 * Bounded, because "the query already loaded it" is not the same as "the
 * payload may carry it": a page is up to 200 rows, each context may be 32KB
 * and each stack 16KB, and every byte crosses the server-component boundary
 * into the client payload. The caps below keep a page's worth of heavy fields
 * to something a browser can hold, and the truncation flags tell the UI when
 * to link to the full event instead.
 */

/**
 * Bytes of `context` a list row may carry.
 *
 * 2KB fits the overwhelming majority of real contexts whole while capping a
 * 200-row page at ~400KB. Raise it only alongside a lower page-size ceiling.
 */
export const LIST_CONTEXT_MAX_BYTES = 2048;

/**
 * Characters of `errorStack` a list row may carry.
 *
 * Long enough for the frames that identify a fault; the full trace is one
 * click away on the event's own page.
 */
export const LIST_STACK_MAX_CHARS = 2000;

/** A heavy field as the list projection exposes it. */
export interface ProjectedContext {
  /** The context, possibly reduced to the entries that fit. `null` when absent. */
  context: unknown;
  /** Whether anything was dropped, so the UI can offer the full record. */
  truncated: boolean;
}

/** A stack trace as the list projection exposes it. */
export interface ProjectedStack {
  /** The stack, possibly cut short. `null` when absent. */
  errorStack: string | null;
  /** Whether it was cut short. */
  truncated: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keeps the entries of a container that fit inside the byte budget.
 *
 * Entries are taken in their stored order and measured one at a time, so a
 * single oversized value is dropped rather than discarding its siblings.
 *
 * The accumulator has a NULL PROTOTYPE, then is spread onto an ordinary object
 * before it leaves. Both halves matter, and neither is about prototype
 * pollution — `Object.prototype` is never written here:
 *
 *  - Assigning a computed `__proto__` key onto a normal object literal reaches
 *    `Object.prototype`'s setter, which ignores a non-object value and stores
 *    nothing. The entry would be counted against the budget, reported as kept,
 *    and then silently not be there. A null-prototype accumulator has no such
 *    setter to reach, so the key lands as data.
 *  - The spread puts the ordinary prototype back, because React refuses to
 *    serialise a null-prototype object across the server/client boundary
 *    ("Classes or null prototypes are not supported"), and this value is part
 *    of a list row that crosses it. Spreading DEFINES each key rather than
 *    assigning it, so `__proto__` survives the trip.
 */
function fitEntries(
  entries: readonly (readonly [string, unknown])[],
  maxBytes: number,
): { kept: Record<string, unknown>; dropped: boolean } {
  const kept: Record<string, unknown> = Object.create(null);
  let used = 0;
  let dropped = false;

  for (const [key, value] of entries) {
    const cost = jsonByteLength({ [key]: value });
    if (used + cost > maxBytes) {
      dropped = true;
      continue;
    }

    kept[key] = value;
    used += cost;
  }

  return { kept: { ...kept }, dropped };
}

/**
 * Bounds a row's `context` for the list projection.
 *
 * @param value - The raw JSON column, which may be `null`.
 * @param maxBytes - The budget; defaults to {@link LIST_CONTEXT_MAX_BYTES}.
 * @returns The context to expose and whether anything was dropped.
 * @example
 * projectListContext({ a: 1 }); // { context: { a: 1 }, truncated: false }
 */
export function projectListContext(
  value: unknown,
  maxBytes: number = LIST_CONTEXT_MAX_BYTES,
): ProjectedContext {
  if (value === null || value === undefined) {
    return { context: null, truncated: false };
  }

  if (jsonByteLength(value) <= maxBytes) {
    return { context: value, truncated: false };
  }

  if (isPlainObject(value)) {
    const { kept, dropped } = fitEntries(Object.entries(value), maxBytes);
    return { context: kept, truncated: dropped };
  }

  if (Array.isArray(value)) {
    const { kept, dropped } = fitEntries(
      value.map((entry, index) => [String(index), entry] as const),
      maxBytes,
    );
    return { context: Object.values(kept), truncated: dropped };
  }

  // A single oversized scalar has no smaller form worth showing.
  return { context: null, truncated: true };
}

/**
 * Bounds a row's `errorStack` for the list projection.
 *
 * @param value - The stored stack, which may be `null`.
 * @param maxChars - The budget; defaults to {@link LIST_STACK_MAX_CHARS}.
 * @returns The stack to expose and whether it was cut short.
 */
export function projectListStack(
  value: string | null,
  maxChars: number = LIST_STACK_MAX_CHARS,
): ProjectedStack {
  if (value === null) return { errorStack: null, truncated: false };
  if (value.length <= maxChars) return { errorStack: value, truncated: false };

  return { errorStack: value.slice(0, maxChars), truncated: true };
}
