import { cn } from "./utils";

/**
 * Real table semantics, styled for density.
 *
 * Every part is the native element — `<table>`, `<thead>`, `<th>`, `<td>` —
 * because a log table is genuinely tabular data and screen readers, column
 * headers and `colSpan` all depend on it. Nothing here is a `<div>` grid
 * pretending.
 *
 * The scroll container is the wrapper rather than the table, so a wide row
 * scrolls horizontally instead of forcing the whole page sideways.
 */
export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

/** The header row group. */
export function TableHeader({
  className,
  ...props
}: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  );
}

/** The body row group. */
export function TableBody({
  className,
  ...props
}: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

/** The footer row group, for totals. */
export function TableFooter({
  className,
  ...props
}: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

/** One row. `data-state="selected"` marks the expanded row in the log stream. */
export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors motion-reduce:transition-none",
        "hover:bg-muted/50 data-[state=selected]:bg-accent",
        className,
      )}
      {...props}
    />
  );
}

/** A column header cell. Callers pass `scope="col"`. */
export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-muted-foreground h-10 px-3 text-left align-middle text-xs font-semibold tracking-wide whitespace-nowrap uppercase",
        className,
      )}
      {...props}
    />
  );
}

/** A data cell. */
export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-3 py-2 align-middle", className)}
      {...props}
    />
  );
}

/** The table's accessible description. Usually visually hidden. */
export function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  );
}
