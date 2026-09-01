/**
 * Pure measurements over JSON-compatible values, shared by the SDK (which
 * trims a payload before sending) and the server (which rejects one that
 * arrives over the limit).
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
 * input, and a deeply nested payload must not be able to blow the stack before
 * the depth limit has a chance to reject it.
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
