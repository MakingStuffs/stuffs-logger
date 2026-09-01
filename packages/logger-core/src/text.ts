import { MAX_CONTEXT_DEPTH } from "./constants";
import type { JsonValue } from "./json";

/**
 * Neutralising text that only LOOKS inert.
 *
 * A log line is attacker-controlled text that gets stored once and then
 * rendered by an unknown number of consumers over its lifetime. React escapes
 * HTML today, so none of this is an injection vector in the dashboard as it
 * stands - but three classes of character are hostile to consumers a log store
 * inevitably grows:
 *
 *  - **ANSI escape sequences** are interpreted by every terminal. A `tail`, a
 *    `kubectl logs`, or a CLI that prints a stored message hands the writer
 *    control of the reader's screen.
 *  - **C0/C1 control characters** break CSV and NDJSON exports, and a bare
 *    carriage return lets one line overwrite another in a terminal.
 *  - **Unicode bidi overrides** need no interpreter at all: U+202E reverses
 *    the visual order of a string, so a message can be made to READ as
 *    something other than what was stored, in the dashboard, right now.
 *
 * Stripping happens once, at ingest, so every consumer inherits it. Newlines
 * and tabs survive - a stack trace without newlines is unreadable, and they
 * are the two controls every downstream format already handles.
 *
 * Every pattern below is assembled from CODE POINTS rather than written as a
 * regex literal: the characters being matched are invisible by definition, and
 * a literal containing them is a literal nobody can review.
 */

/** The character at a code point, named so the patterns below read. */
function codePoint(value: number): string {
  return String.fromCodePoint(value);
}

/** An inclusive character-class range between two code points. */
function codePointRange(from: number, to: number): string {
  return `${codePoint(from)}-${codePoint(to)}`;
}

/** ESC - the character every ANSI escape sequence opens with. */
const ESCAPE = codePoint(0x1b);

/** BEL - one of the two terminators an OSC sequence may use. */
const BELL = codePoint(0x07);

/**
 * ANSI escape sequences: CSI (`ESC [ ... final`), OSC (`ESC ] ... BEL` or
 * `ESC ] ... ESC \`), and the two-character forms.
 *
 * Removed BEFORE the control-character pass: stripping the leading ESC first
 * would leave the `[31m` payload behind as literal text.
 */
const ANSI_SEQUENCE = new RegExp(
  `${ESCAPE}(?:\\[[0-9;:?]*[ -/]*[@-~]|\\][^${BELL}${ESCAPE}]*(?:${BELL}|${ESCAPE}\\\\)?|[@-Z\\\\-_])`,
  "g",
);

/**
 * C0 controls except tab (0x09) and newline (0x0A), plus DEL and the C1 block.
 *
 * Carriage return (0x0D) is absent because it is normalised to a newline
 * first - dropping it outright would join two lines of a stack trace.
 */
const CONTROL_CHARACTERS = new RegExp(
  `[${codePointRange(0x00, 0x08)}${codePoint(0x0b)}${codePoint(0x0c)}${codePointRange(0x0e, 0x1f)}${codePointRange(0x7f, 0x9f)}]`,
  "g",
);

/**
 * Bidirectional formatting characters that reorder text visually: the
 * embedding/override set (U+202A to U+202E), the isolate set (U+2066 to
 * U+2069) and the Arabic letter mark (U+061C).
 */
const BIDI_CONTROLS = new RegExp(
  `[${codePoint(0x061c)}${codePointRange(0x202a, 0x202e)}${codePointRange(0x2066, 0x2069)}]`,
  "g",
);

/** Any carriage return, including the CRLF pair, normalised to one newline. */
const CARRIAGE_RETURNS = /\r\n?/g;

/**
 * Strips escape sequences, control characters and bidi overrides from a string.
 *
 * @param value - Untrusted text: a message, a stack trace, a context value.
 * @returns The same text with only printable characters, tabs and newlines.
 * @example
 * sanitiseLogText(`${ESC}[31mred${ESC}[0m`); // "red"
 */
export function sanitiseLogText(value: string): string {
  return value
    .replace(ANSI_SEQUENCE, "")
    .replace(CARRIAGE_RETURNS, "\n")
    .replace(CONTROL_CHARACTERS, "")
    .replace(BIDI_CONTROLS, "");
}

/**
 * Applies {@link sanitiseLogText} to a nullable field.
 *
 * @param value - The text, or `null`/`undefined` when the field is absent.
 * @returns The sanitised text, or `null`.
 */
export function sanitiseOptionalLogText(
  value: string | null | undefined,
): string | null {
  return value === null || value === undefined ? null : sanitiseLogText(value);
}

/** One level past the wire contract's nesting limit; see `redaction.ts`. */
const MAX_SANITISE_DEPTH = MAX_CONTEXT_DEPTH + 1;

/**
 * Applies {@link sanitiseLogText} to every string in a JSON structure, keys
 * included.
 *
 * Keys as well as values: a context key is rendered next to its value in the
 * dashboard and written into the header row of any export, so an escape
 * sequence hidden in a key would survive a values-only pass.
 *
 * @param value - The value to sanitise. Not mutated.
 * @returns A new value with every string cleaned.
 * @example
 * sanitiseJsonText({ a: "b" }); // { a: "b" }
 */
export function sanitiseJsonText(value: JsonValue): JsonValue {
  return sanitiseAtDepth(value, 0);
}

function sanitiseAtDepth(value: JsonValue, depth: number): JsonValue {
  if (typeof value === "string") return sanitiseLogText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_SANITISE_DEPTH) return null;

  if (Array.isArray(value)) {
    return value.map((entry) => sanitiseAtDepth(entry, depth + 1));
  }

  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[sanitiseLogText(key)] = sanitiseAtDepth(entry, depth + 1);
  }

  return result;
}
