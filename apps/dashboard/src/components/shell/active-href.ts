/**
 * Deciding which navigation entry the current URL belongs to.
 *
 * A pure function rather than a branch inside the link component, because the
 * interesting cases are all string edges — a section root, a child route, a
 * sibling whose name starts with the same characters — and those are worth
 * pinning in tests without rendering anything.
 */

/** The route every other route hangs off. Only ever an exact match. */
const ROOT_PATH = "/";

/**
 * Whether a navigation entry covers the page currently on screen.
 *
 * A section entry stays marked while the reader is anywhere inside it, so
 * `/logs/abc123` still highlights "Logs" — otherwise opening one event would
 * appear to leave the section it belongs to.
 *
 * The overview is matched exactly: every path begins with `/`, so a prefix
 * rule would mark it current on every page in the app.
 *
 * @param pathname - The path currently rendered, without a query string.
 * @param href - The entry's destination.
 * @returns Whether the entry should be marked as the current page.
 * @example
 * isActiveHref("/logs/abc", "/logs"); // true
 * isActiveHref("/apps", "/"); // false
 */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href === ROOT_PATH) return pathname === ROOT_PATH;

  // The separator matters: without it `/apps` would also claim `/apps-legacy`.
  return pathname === href || pathname.startsWith(`${href}/`);
}
