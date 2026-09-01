import type { LogEventPage } from "@/lib/logs/dto";
import type { LogFilters } from "@/lib/logs/filters";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
} from "../ui/pagination";

import { formatCount } from "./format";
import { firstPageHref, nextPageHref } from "./search-params";

/**
 * Paging through the stream.
 *
 * The data layer pages by CURSOR, which is what keeps results stable while new
 * events arrive — but a cursor only points forward, so there is no meaningful
 * "previous page" href to offer. The browser's own back button is the way back,
 * and "Newest" returns to the top of the current filter set.
 */
export function LogPagination({
  filters,
  page,
}: {
  filters: LogFilters;
  page: LogEventPage;
}) {
  const isFirstPage = filters.cursor === undefined;

  if (isFirstPage && !page.hasMore) {
    return (
      <p className="text-muted-foreground text-sm">
        Showing all {formatCount(page.items.length)}{" "}
        {page.items.length === 1 ? "event" : "events"}.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground text-sm">
        Showing {formatCount(page.items.length)}{" "}
        {page.items.length === 1 ? "event" : "events"}
        {isFirstPage ? "" : " on this page"}.
      </p>

      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          {isFirstPage ? null : (
            <PaginationItem>
              <PaginationLink href={firstPageHref(filters)}>
                Newest
              </PaginationLink>
            </PaginationItem>
          )}
          {page.nextCursor === null ? null : (
            <PaginationItem>
              <PaginationNext href={nextPageHref(filters, page.nextCursor)} />
            </PaginationItem>
          )}
        </PaginationContent>
      </Pagination>
    </div>
  );
}
