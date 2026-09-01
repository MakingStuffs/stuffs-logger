import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "./button";
import { cn } from "./utils";

/**
 * Paging controls.
 *
 * Every part renders a real `<a href>` via `next/link`, never a button that
 * calls `router.push`: a page of results has an address, and an address has to
 * survive a middle click, a bookmark and a crawler.
 *
 * There is no "previous" part on purpose. The log stream pages by cursor,
 * which only points forward — a component that offered a back link would be
 * offering one it cannot build.
 */
export function Pagination({
  className,
  ...props
}: React.ComponentProps<"nav">) {
  return (
    <nav
      // Named, because a page can carry more than one navigation landmark.
      aria-label="Pagination"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  );
}

/** The list of page controls. */
export function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex list-none flex-row items-center gap-1", className)}
      {...props}
    />
  );
}

/** One control in the list. */
export function PaginationItem(props: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}

/** Props for {@link PaginationLink}. */
export interface PaginationLinkProps extends React.ComponentProps<typeof Link> {
  /** Whether this link points at the page currently on screen. */
  isActive?: boolean;
}

/** A link to another page of results. */
export function PaginationLink({
  className,
  isActive = false,
  ...props
}: PaginationLinkProps) {
  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      data-slot="pagination-link"
      className={cn(
        buttonVariants({ variant: isActive ? "outline" : "ghost", size: "sm" }),
        className,
      )}
      {...props}
    />
  );
}

/** The link to the next page of results. */
export function PaginationNext({ className, ...props }: PaginationLinkProps) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      className={cn("gap-1", className)}
      {...props}
    >
      <span>Next</span>
      <ChevronRight aria-hidden="true" />
    </PaginationLink>
  );
}
