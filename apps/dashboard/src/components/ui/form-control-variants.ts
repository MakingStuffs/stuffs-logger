import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

/**
 * The shared visual identity of anything a user types into or picks from.
 *
 * One definition, because the log explorer's filter panel puts a native
 * `<select>`, a `datetime-local` input and a search box on the same row: they
 * only line up if height, padding, radius, colour and focus state come from
 * the same place. A new field-like control imports this rather than reaching
 * for `h-9` and hoping.
 *
 * Deliberately styled with plain classes and no JavaScript, so it can dress a
 * bare `<select>` on a server-rendered page that ships no client bundle.
 *
 * @example
 * <select className={cn(formControlVariants(), "cursor-pointer")} />
 * @example
 * <textarea className={cn(formControlVariants({ variant: "multiline" }))} />
 */
export const formControlVariants = cva(
  [
    "flex w-full min-w-0 rounded-md border bg-input px-3 text-sm text-foreground",
    // `border-control`, never `border-border`: a field's edge is what tells a
    // reader where the field is, so it has to clear 3:1 against the page.
    "border-control transition-colors motion-reduce:transition-none",
    "placeholder:text-muted-foreground",
    "hover:border-foreground/45",
    "focus-visible:border-ring focus-visible:ring-ring/35 focus-visible:ring-2 focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/30",
  ].join(" "),
  {
    variants: {
      variant: {
        /** Single-line: a fixed 36px so adjacent controls agree to the pixel. */
        default: "h-9 py-1",
        /** Multi-line: grows with content, but never smaller than five rows. */
        multiline: "min-h-24 py-2",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

/** The variants {@link formControlVariants} accepts. */
export type FormControlVariants = VariantProps<typeof formControlVariants>;
