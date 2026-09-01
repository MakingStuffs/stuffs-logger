import { cn } from "./utils";

/**
 * A raised surface holding one coherent thing.
 *
 * Separated from the page by a border and a lighter fill rather than a
 * shadow: at the densities this app renders — a grid of application cards, a
 * stack of detail panels — shadows stack into mud, while a hairline stays
 * legible in both themes.
 *
 * @example
 * <Card>
 *   <CardHeader>
 *     <CardTitle>Checkout</CardTitle>
 *     <CardDescription>checkout</CardDescription>
 *   </CardHeader>
 *   <CardContent>…</CardContent>
 * </Card>
 */
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "bg-card text-card-foreground rounded-lg border",
        className,
      )}
      {...props}
    />
  );
}

/** The card's title block. */
export function CardHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 p-5", className)}
      {...props}
    />
  );
}

/**
 * The card's name.
 *
 * A `<div>`, not a heading: cards appear inside lists whose surrounding
 * heading level differs by page, and a component that guessed `<h3>` would
 * skip levels somewhere. Pages that need a heading pass one as a child.
 */
export function CardTitle({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-snug font-semibold", className)}
      {...props}
    />
  );
}

/** Supporting copy under the title. */
export function CardDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

/** The card's body. */
export function CardContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-5 pb-5", className)}
      {...props}
    />
  );
}

/** The card's actions or metadata, separated by a rule. */
export function CardFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center border-t px-5 py-3", className)}
      {...props}
    />
  );
}
