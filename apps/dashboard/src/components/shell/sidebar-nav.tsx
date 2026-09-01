import { LogOut, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

import { NavLink } from "./nav-link";

/**
 * One entry in the main navigation.
 *
 * The icon is the lucide COMPONENT, not its name. Naming it as a string would
 * need a lookup table of every icon in the set, which is both a bundle the app
 * does not need and a typo the compiler cannot catch.
 */
export interface BasicLink {
  /** What to call the section. */
  label: string;
  /** Where it goes. */
  href: string;
  /** The icon shown beside the label. Decorative — the label carries it. */
  icon: LucideIcon;
}

/** The signed-in user, as much of them as the chrome needs to show. */
export interface SidebarUser {
  /** Display name. */
  name: string;
  /** Email address, shown beneath the name. */
  email: string;
  /** What the account may do. Shown so a refusal elsewhere makes sense. */
  role?: string;
}

/** Props for {@link AppSidebar}. */
export interface AppSidebarProps {
  /** The product's name, shown beside the mark. */
  appName: string;
  /** The sections to offer. */
  links: BasicLink[];
  /** The signed-in user. Omit it and the account block is not rendered. */
  user?: SidebarUser;
  /**
   * Signs the user out. A server action, submitted by a real form, so signing
   * out is a POST that works before hydration and cannot be triggered by a
   * link someone was sent.
   *
   * Omit it and no sign-out control is offered.
   */
  signOutAction?: () => Promise<void>;
}

/**
 * The app's main navigation.
 *
 * A server component with no state of its own: a fixed rail on a wide screen,
 * a wrapping bar on a narrow one. What it shows never depends on the browser,
 * so nothing here needs to hydrate — the only client code in the chrome is the
 * {@link NavLink} leaf that marks the current section.
 *
 * The entries are presentation, not access control. Hiding a section only
 * stops it being offered; every page behind an `href` gates itself, and the
 * data layer gates itself again behind that.
 */
export function AppSidebar({
  appName,
  links,
  user,
  signOutAction,
}: AppSidebarProps) {
  return (
    <div
      className={[
        "bg-card flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2",
        "lg:sticky lg:top-0 lg:h-svh lg:w-60 lg:shrink-0 lg:flex-col lg:flex-nowrap",
        "lg:items-stretch lg:gap-0 lg:border-r lg:border-b-0 lg:px-3 lg:py-4",
      ].join(" ")}
    >
      <Link
        href="/"
        className="focus-visible:ring-ring/40 flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
          <Terminal className="size-4" aria-hidden="true" />
        </span>
        <span className="text-sm font-semibold tracking-tight">{appName}</span>
      </Link>

      <nav
        aria-label="Main"
        className="min-w-0 flex-1 lg:mt-6 lg:w-full lg:flex-none"
      >
        <ul className="flex list-none flex-row gap-1 overflow-x-auto lg:flex-col lg:overflow-x-visible">
          {links.map((link) => (
            <li key={link.href}>
              {/* The icon is rendered here, on the server, and handed to the
                  client leaf as children — a component reference could not
                  cross that boundary. */}
              <NavLink href={link.href}>
                <link.icon aria-hidden="true" />
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {user === undefined ? null : (
        <AccountBlock user={user} signOutAction={signOutAction} />
      )}
    </div>
  );
}

/** The account summary and the way out. */
function AccountBlock({
  user,
  signOutAction,
}: {
  user: SidebarUser;
  signOutAction?: () => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 lg:mt-auto lg:w-full lg:flex-col lg:items-stretch lg:gap-2 lg:border-t lg:pt-3">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        >
          {toInitials(user.name)}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{user.name}</span>
          <span className="text-muted-foreground truncate text-xs">
            {user.email}
          </span>
        </div>
      </div>

      {user.role === undefined ? null : (
        <Badge variant="outline" className="w-fit">
          {user.role}
        </Badge>
      )}

      {signOutAction === undefined ? null : (
        <form action={signOutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="w-full justify-start px-2"
          >
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </form>
      )}
    </div>
  );
}

/**
 * The first letters of the first and last words of a name.
 *
 * @param name - The user's display name.
 * @returns One or two uppercase letters, or `?` for a name with no letters.
 */
function toInitials(name: string): string {
  const words = name.split(/\s+/).filter((word) => word.length > 0);
  const first = words.at(0)?.at(0);
  const last = words.length > 1 ? words.at(-1)?.at(0) : undefined;
  const initials = `${first ?? ""}${last ?? ""}`;

  return initials === "" ? "?" : initials.toUpperCase();
}
