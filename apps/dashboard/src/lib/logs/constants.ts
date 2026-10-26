/**
 * Page-size bounds for the log explorer.
 *
 * In a module of their own, with no imports, because they are needed on BOTH
 * sides of the server/client boundary: `lib/logs/filters.ts` validates against
 * them on the server, and the client-rendered log row imports the vocabulary
 * module that offers them in the page-size menu. Keeping them next to the zod
 * schema dragged zod and the whole filter schema into the browser bundle for
 * two integers.
 */

/** Default page size when the caller does not ask for one. */
export const DEFAULT_PAGE_SIZE = 50;

/** Hard ceiling on page size, whatever the caller asks for. */
export const MAX_PAGE_SIZE = 200;
