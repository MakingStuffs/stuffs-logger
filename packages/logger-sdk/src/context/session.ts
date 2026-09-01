import { MAX_SHORT_FIELD_LENGTH } from "../contract";
import { SESSION_STORAGE_KEY } from "../defaults";

/**
 * The browser session identifier.
 *
 * Persisted in `sessionStorage` rather than `localStorage` or a cookie: it must
 * survive a reload and an in-tab navigation so one visit reads as one session
 * in the dashboard, but it must NOT be a durable cross-visit identifier. It is
 * a random opaque value tied to nothing — it identifies a tab's lifetime, not
 * a person.
 *
 * `sessionStorage` throws outright in sandboxed iframes and in some privacy
 * modes, so every access is guarded and the failure mode is simply an
 * unidentified session.
 */

function randomId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function")
    return randomUUID.call(globalThis.crypto);

  // `crypto.randomUUID` is absent on insecure origins and in very old engines.
  // The identifier only has to be distinct, not unguessable: it carries no
  // authority, grants no access, and is scoped to one tab's lifetime.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readStored(): string | undefined {
  try {
    const stored = globalThis.sessionStorage?.getItem(SESSION_STORAGE_KEY);
    return stored && stored.length > 0 ? stored : undefined;
  } catch {
    // Storage is unavailable or blocked.
    return undefined;
  }
}

function writeStored(value: string): void {
  try {
    globalThis.sessionStorage?.setItem(SESSION_STORAGE_KEY, value);
  } catch {
    // Storage is unavailable, blocked, or full. The id stays in memory.
  }
}

/**
 * Returns the current tab's session id, creating and persisting one if needed.
 *
 * @returns An id of at most `MAX_SHORT_FIELD_LENGTH` characters.
 * @example
 * resolveSessionId(); // "9f1c…"
 */
export function resolveSessionId(): string {
  const existing = readStored();
  if (existing) return existing.slice(0, MAX_SHORT_FIELD_LENGTH);

  const created = randomId().slice(0, MAX_SHORT_FIELD_LENGTH);
  writeStored(created);
  return created;
}
