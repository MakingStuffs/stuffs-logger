/**
 * The size limits on an application's editable fields.
 *
 * A module of plain constants with no imports, so the client dialogs can cap
 * their inputs at exactly the lengths the actions' schemas enforce without
 * pulling a server module onto the client graph. The schemas are the check
 * that counts; the `maxLength` attributes built from these are the courtesy
 * copy that stops a limit being discovered only after a round trip.
 */

/** Longest display name an application may carry. */
export const MAX_APPLICATION_NAME_LENGTH = 64;

/** Longest description, sized for one or two sentences on a card. */
export const MAX_APPLICATION_DESCRIPTION_LENGTH = 280;

/** Longest slug. It is a URL segment and a filter value, so it stays short. */
export const MAX_APPLICATION_SLUG_LENGTH = 64;
