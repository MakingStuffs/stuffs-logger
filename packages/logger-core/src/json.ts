/**
 * Pure operations over JSON-compatible values — measuring them, and building
 * them safely. Shared by the SDK (which trims a payload before sending) and
 * the server (which rejects one that arrives over the limit).
 */

/** A value that survives a `JSON.stringify` / `JSON.parse` round trip. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const encoder = new TextEncoder();

/**
 * The UTF-8 byte length of a value once serialised to JSON.
 *
 * @param value - The value to measure.
 * @returns The byte length, or `Number.POSITIVE_INFINITY` when the value
 *   cannot be serialised at all (a circular reference, a BigInt). Returning
 *   infinity rather than throwing means every size check fails closed.
 * @example
 * jsonByteLength({ a: 1 }); // 7
 */
export function jsonByteLength(value: unknown): number {
  try {
    const serialised = JSON.stringify(value);
    if (serialised === undefined) return Number.POSITIVE_INFINITY;
    return encoder.encode(serialised).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isContainer(
  node: unknown,
): node is unknown[] | Record<string, unknown> {
  return typeof node === "object" && node !== null;
}

/**
 * How many levels of nested objects/arrays a value contains.
 *
 * Scalars are depth 0; `{ a: 1 }` is depth 1; `{ a: { b: 1 } }` is depth 2.
 *
 * Iterative rather than recursive on purpose: this runs on attacker-supplied
 * input and is the ONE walk over a context that is safe on a payload nested
 * thousands of levels deep. Every other walk recurses — `JSON.stringify`
 * inside {@link jsonByteLength}, zod's lazy `z.json()` parse — and overflows
 * the stack on exactly that input. Being iterative only helps if this runs
 * before those; `schemas.ts` orders its context checks so that it does.
 *
 * @param value - The value to measure.
 * @param limit - Stop descending once this depth is exceeded. The return value
 *   is then `limit + 1`, which is all a caller comparing against a maximum
 *   needs to know.
 * @returns The nesting depth.
 * @example
 * jsonDepth({ a: { b: 1 } }); // 2
 */
export function jsonDepth(value: unknown, limit = 64): number {
  let deepest = 0;
  const stack: Array<{ node: unknown; depth: number }> = [
    { node: value, depth: 0 },
  ];

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    if (!isContainer(entry.node)) continue;

    const depth = entry.depth + 1;
    if (depth > deepest) deepest = depth;
    if (depth > limit) return deepest;

    const children = Array.isArray(entry.node)
      ? entry.node
      : Object.values(entry.node);
    for (const child of children) {
      if (isContainer(child)) stack.push({ node: child, depth });
    }
  }

  return deepest;
}

/**
 * Adds one entry to a JSON object being built from computed keys.
 *
 * Plain assignment is not safe here. `result[key] = value` goes through
 * `[[Set]]`, and `__proto__` is an ACCESSOR inherited from `Object.prototype`:
 * assigning it runs the setter instead of creating a property, so the entry
 * silently disappears and an object value becomes the accumulator's prototype.
 * Nothing is polluted — `Object.prototype` itself is never touched — but a
 * function whose contract is to preserve structure quietly loses a field, and
 * the key that triggers it can arrive through any transform that produces
 * `__proto__` from something else (`sanitiseLogText("__pro to__")` does).
 *
 * Defining the property instead creates an own data property for every key,
 * `__proto__` included, and leaves the accumulator an ordinary object for
 * everything downstream.
 *
 * @param target - The object under construction. Mutated.
 * @param key - The computed key, trusted for nothing.
 * @param value - The value to store under it.
 * @example
 * const result: Record<string, JsonValue> = {};
 * setJsonEntry(result, "__proto__", { a: 1 }); // kept as an own property
 */
export function setJsonEntry(
  target: Record<string, JsonValue>,
  key: string,
  value: JsonValue,
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
