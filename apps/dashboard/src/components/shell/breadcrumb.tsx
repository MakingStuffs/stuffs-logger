import { ChevronRight } from "lucide-react";
import Link from "next/link";

/** One step in a breadcrumb trail. The last step has no destination. */
export interface BreadcrumbItem {
  /** What to call this step. */
  label: string;
  /** Where it goes. Omitted on the current page. */
  href?: string;
}

/**
 * The trail back up from a nested page.
 *
 * An ordered list inside a named `<nav>`, because that is what assistive
 * technology expects a breadcrumb to be. The last item is the current page:
 * it is not a link — there is nowhere to go — and carries `aria-current` so it
 * is announced as the destination rather than as a dead entry.
 *
 * Separators are `aria-hidden`: they are punctuation, and reading "chevron
 * right" between every step makes the trail slower to hear than to see.
 *
 * @example
 * <Breadcrumb items={[{ label: "Log explorer", href: "/logs" }, { label: "Event" }]} />
 */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb">
      <ol className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
        {items.map((item, index) => (
          <li
            key={`${item.label}-${index}`}
            className="flex items-center gap-1"
          >
            {index > 0 ? (
              <ChevronRight aria-hidden="true" className="size-3 shrink-0" />
            ) : null}
            {item.href === undefined ? (
              <span aria-current="page" className="text-foreground font-medium">
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="hover:text-foreground focus-visible:ring-ring/40 rounded-xs underline-offset-2 transition-colors hover:underline focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
              >
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
