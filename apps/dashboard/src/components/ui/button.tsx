import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "./utils";

/**
 * Button styling.
 *
 * Four variants and no more, because a page with six kinds of button has no
 * hierarchy: `default` is the one action a screen is asking for, `outline` is
 * everything else, `destructive` is the one that cannot be undone, and `ghost`
 * is for controls that live inside another surface (pagination, toolbars).
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2",
    "rounded-md border text-sm font-medium whitespace-nowrap",
    "transition-colors motion-reduce:transition-none",
    "focus-visible:ring-ring/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:outline-none",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:border-primary/90",
        // `border-control` rather than `border-border`: the outline IS the
        // affordance here, so it has to clear 3:1 against the page.
        outline:
          "border-control bg-card text-foreground hover:bg-accent hover:text-accent-foreground",
        destructive:
          "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:border-destructive/90 focus-visible:ring-destructive/40",
        ghost:
          "border-transparent bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 gap-1.5 px-3 text-xs",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/** Props for {@link Button}. */
export interface ButtonProps
  extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /**
   * Render the child element with the button's styling instead of a `<button>`.
   * Used for links that should look like buttons — navigation stays a real
   * `<a>`, so it is crawlable, middle-clickable and keyboard-operable.
   */
  asChild?: boolean;
}

/**
 * The app's button.
 *
 * @example
 * <Button variant="outline" size="sm" asChild>
 *   <Link href="/logs">Open log explorer</Link>
 * </Button>
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
