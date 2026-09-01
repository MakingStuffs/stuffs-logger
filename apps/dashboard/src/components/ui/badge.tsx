import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "./utils";

/**
 * Badge styling, ordered as a loudness ramp.
 *
 * `outline` → `secondary` → `warning` → `destructive` → `critical` gets
 * progressively more insistent, which is what lets a severity column be read
 * by weight at a glance. Colour is never the only signal: a badge always
 * contains its own label as text, so the ramp survives a colour-blind reader,
 * a greyscale print and a forced-colours mode.
 */
const badgeVariants = cva(
  [
    "inline-flex w-fit shrink-0 items-center justify-center gap-1",
    "rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
    "[&_svg]:pointer-events-none [&_svg]:size-3",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground",
        secondary: "border-border bg-secondary text-secondary-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        warning: "border-warning bg-warning text-warning-foreground",
        destructive:
          "border-destructive bg-destructive text-destructive-foreground",
        // The top of the ramp: the same red as `destructive`, plus a halo and
        // a heavier weight, so a fatal is distinguishable from an error even
        // when the two sit in the same column.
        critical:
          "border-destructive bg-destructive text-destructive-foreground font-semibold ring-2 ring-destructive/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

/** Props for {@link Badge}. */
export interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

/**
 * A short status label.
 *
 * A `<span>` rather than a `<div>` so it is valid inside the paragraphs, table
 * cells and `<dd>` elements it actually appears in.
 *
 * @example
 * <Badge variant="critical">Fatal</Badge>
 */
export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { badgeVariants };
