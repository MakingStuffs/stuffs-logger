import { MAX_APPLICATION_SLUG_LENGTH } from "./limits";

/**
 * The application slug's shape, and a suggestion derived from a name.
 *
 * Kept free of zod and of anything server-side so the create dialog can offer
 * a suggestion as the name is typed. The server never trusts that suggestion:
 * `applicationSlugSchema` in `./queries.ts` is built from this same pattern
 * and re-checks whatever is submitted.
 */

/**
 * Lowercase alphanumerics and hyphens, starting with an alphanumeric.
 *
 * The slug is a route segment (`/apps/<slug>`) and the value of every
 * `applicationSlug` filter in a shared link, so it must survive a URL
 * untouched — no encoding, no case folding.
 */
export const APPLICATION_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Combining marks left behind once an accented letter is decomposed. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Every run of characters a slug cannot hold. */
const DISALLOWED_RUNS = /[^a-z0-9]+/g;

/** Hyphens at either end, which the pattern refuses at the start. */
const EDGE_HYPHENS = /^-+|-+$/g;

/**
 * Suggests a slug for an application name.
 *
 * Accents are folded to their base letter rather than dropped ("Café" becomes
 * `cafe`, not `caf`), and every other run of disallowed characters becomes a
 * single hyphen.
 *
 * @param name - The name as typed, untrusted and possibly empty.
 * @returns A slug matching {@link APPLICATION_SLUG_PATTERN}, or `""` when the
 *   name has nothing a slug could be built from.
 * @example
 * suggestSlug("Checkout — Production"); // "checkout-production"
 */
export function suggestSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(DISALLOWED_RUNS, "-")
    .replace(EDGE_HYPHENS, "")
    .slice(0, MAX_APPLICATION_SLUG_LENGTH)
    .replace(EDGE_HYPHENS, "");
}
