import { cn } from "./utils";

/**
 * The standard page content container.
 *
 * One place decides how wide a page's body is and how it is centred, so every
 * route lines up with every other route. Vertical rhythm and layout are the
 * page's own business and arrive through `className`.
 *
 * `w-full` is load-bearing: without it the element shrinks to its content
 * inside a flex parent and `mx-auto` centres nothing.
 *
 * The maximum is wide — this is a log viewer, and a stack trace forced into a
 * narrow measure is harder to read, not easier.
 *
 * @example
 * <PageContentWrapper className="flex flex-col gap-6 px-6 py-8">
 *   <LogTable events={events} />
 * </PageContentWrapper>
 */
export function PageContentWrapper({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-content-wrapper"
      className={cn("mx-auto w-full max-w-7xl", className)}
      {...props}
    />
  );
}
