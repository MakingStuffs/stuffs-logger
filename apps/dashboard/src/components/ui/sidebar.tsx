import { cn } from "./utils";

/**
 * The frame the app chrome is laid out in.
 *
 * Owns exactly one decision — that the navigation rail and the content column
 * sit side by side on a wide screen and stack on a narrow one — so no page has
 * to re-derive it.
 *
 * Deliberately stateless, and therefore a server component with no client
 * bundle at all. There is no collapse toggle to persist because the navigation
 * is four entries long: collapsing it would trade a permanently useful rail
 * for a control that has to be operated, and would drag hydration, a storage
 * round trip and a first-paint flash into a shell that currently ships none of
 * them. Children pass straight through, so everything inside stays a server
 * component too.
 *
 * @example
 * <SidebarProvider>
 *   <AppSidebar links={LINKS} />
 *   <main>{children}</main>
 * </SidebarProvider>
 */
export function SidebarProvider({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-provider"
      className={cn("flex min-h-svh w-full flex-col lg:flex-row", className)}
      {...props}
    />
  );
}
