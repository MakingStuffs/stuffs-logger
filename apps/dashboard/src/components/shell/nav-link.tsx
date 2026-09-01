"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "../ui/utils";

import { isActiveHref } from "./active-href";

/**
 * A navigation entry that knows whether it is the page you are on.
 *
 * The one client component in the app chrome, and it is a leaf: the icon and
 * label arrive already rendered as `children` from the server, so nothing else
 * in the shell crosses the boundary. It exists because the current path is
 * only knowable in the browser after a client-side navigation — a server
 * component would keep highlighting whichever entry was current when the shell
 * was rendered.
 *
 * "Current" is carried by `aria-current="page"` as well as by colour, so the
 * position in the app is announced rather than merely shown.
 */
export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = isActiveHref(pathname, href);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm whitespace-nowrap transition-colors motion-reduce:transition-none",
        "focus-visible:ring-ring/40 focus-visible:ring-2 focus-visible:outline-none",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        isActive
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
