import type { LucideIcon } from "lucide-react";

import { Breadcrumb } from "./breadcrumb";
import type { BreadcrumbItem } from "./breadcrumb";

export type { BreadcrumbItem };

/** Props for {@link AppHeader}. */
export interface AppHeaderProps {
  /** The page's title. Rendered as its one `<h1>`. */
  header: string;
  /** One line saying what the page is for. */
  copy?: string;
  /** A lucide icon identifying the section. Decorative. */
  icon?: LucideIcon;
  /**
   * Page-level actions, rendered in a toolbar beneath the title. Omit them and
   * no toolbar row is drawn, so a page with nothing to offer gets no empty bar.
   */
  children?: React.ReactNode;
  /** The trail back up, for a page nested inside a section. */
  breadcrumbs?: BreadcrumbItem[];
}

/**
 * The page header: what this page is, and what can be done to it.
 *
 * STICKY, because the log explorer is a page people scroll a long way down
 * and then need to act on — losing the "clear filters" control at row 180 is
 * the difference between triage and scrolling back up.
 *
 * Owns the page's `<h1>`. Pages therefore never render one of their own, which
 * is what keeps the document to exactly one top-level heading and the outline
 * predictable for a screen reader.
 *
 * @example
 * <AppHeader header="Log explorer" copy="Search every log line." icon={ScrollText}>
 *   <Button variant="outline" size="sm">Export</Button>
 * </AppHeader>
 */
export function AppHeader({
  header,
  copy,
  icon: Icon,
  children,
  breadcrumbs,
}: AppHeaderProps) {
  const hasBreadcrumbs = breadcrumbs !== undefined && breadcrumbs.length > 0;

  return (
    <div className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-30 backdrop-blur">
      <header className="flex flex-col gap-2 border-b px-6 py-3">
        {hasBreadcrumbs ? <Breadcrumb items={breadcrumbs} /> : null}

        <div className="flex items-center gap-3">
          {Icon === undefined ? null : (
            <span className="bg-accent text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
              <Icon className="size-5" aria-hidden="true" />
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="truncate text-base font-semibold tracking-tight">
              {header}
            </h1>
            {copy === undefined ? null : (
              <p className="text-muted-foreground truncate text-xs">{copy}</p>
            )}
          </div>
        </div>
      </header>

      {children === undefined ? null : (
        <nav
          aria-label="Page actions"
          className="bg-background/60 flex flex-wrap items-center gap-2 border-b px-6 py-2"
        >
          {children}
        </nav>
      )}
    </div>
  );
}
