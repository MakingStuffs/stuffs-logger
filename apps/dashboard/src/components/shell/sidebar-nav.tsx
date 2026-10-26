import { LogOut, Terminal, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

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
  /**
   * A further navigation group beneath the main one — in practice the
   * administrator-only {@link SidebarNavGroup}, streamed in its own
   * `<Suspense>` because whether to show it depends on the session.
   */
  secondaryNav?: React.ReactNode;
  /**
   * Whatever belongs at the foot of the rail — in practice the
   * {@link SidebarAccount} block, or its skeleton while the session resolves.
   *
   * A slot rather than a `user` prop so the layout can stream it: the account
   * block is the one part of the chrome that needs a request-time read, and
   * handing it in as a child lets that read sit inside its own `<Suspense>`
   * boundary without the navigation ever waiting on it.
   */
  children?: React.ReactNode;
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
  secondaryNav,
  children,
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
        <NavLinkList links={links} />
      </nav>

      {secondaryNav}

      {children}
    </div>
  );
}

/** A list of navigation entries, shared by every group in the rail. */
function NavLinkList({ links }: { links: BasicLink[] }) {
  return (
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
  );
}

/** Props for {@link SidebarNavGroup}. */
export interface SidebarNavGroupProps {
  /** The group's name — its visible heading and its landmark's label. */
  label: string;
  /** The entries in the group. */
  links: BasicLink[];
}

/**
 * A labelled group of navigation entries beneath the main one.
 *
 * Its own `<nav>` landmark, named by its heading, so a screen reader lists
 * "Administration" beside "Main" instead of merging the two. Presentation
 * only: whoever renders it decides whether it is offered, and every page
 * behind an entry gates itself regardless.
 */
export function SidebarNavGroup({ label, links }: SidebarNavGroupProps) {
  const headingId = `nav-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <nav
      aria-labelledby={headingId}
      className="flex min-w-0 items-center gap-2 lg:mt-6 lg:w-full lg:flex-col lg:items-stretch"
    >
      <h2
        id={headingId}
        className="text-muted-foreground px-2.5 text-xs font-medium tracking-wide uppercase max-lg:sr-only"
      >
        {label}
      </h2>
      <NavLinkList links={links} />
    </nav>
  );
}

/**
 * The account block's frame: a wrapping row in the narrow bar, a column pinned
 * to the foot of the wide rail. Shared with the skeleton so the two occupy the
 * same space and the swap moves nothing.
 */
const ACCOUNT_BLOCK_CLASS =
  "flex flex-wrap items-center gap-2 lg:mt-auto lg:w-full lg:flex-col lg:items-stretch lg:gap-2 lg:border-t lg:pt-3";

/** Props for {@link SidebarAccount}. */
export interface SidebarAccountProps {
  /** The signed-in user. */
  user: SidebarUser;
  /**
   * Signs the user out. A server action, submitted by a real form, so signing
   * out is a POST that works before hydration and cannot be triggered by a
   * link someone was sent.
   *
   * Omit it and no sign-out control is offered.
   */
  signOutAction?: () => Promise<void>;
  /**
   * Where the signed-in user manages their own account. Omit it and no
   * account link is offered.
   */
  accountHref?: string;
}

/**
 * The account summary and the way out.
 *
 * Holds no auth logic. Whoever renders it has already resolved a session and
 * passes down only the fields shown — displaying a name is not an access
 * decision, and nothing here is treated as one.
 */
export function SidebarAccount({
  user,
  signOutAction,
  accountHref,
}: SidebarAccountProps) {
  return (
    <div className={ACCOUNT_BLOCK_CLASS}>
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

      {accountHref === undefined ? null : (
        <NavLink href={accountHref}>
          <UserRound aria-hidden="true" />
          Account
        </NavLink>
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
 * The account block's loading state: the avatar, two lines of text, a role
 * badge, the account link and the sign-out control, each at its real size, so
 * the resolved block
 * lands exactly where the placeholder stood.
 */
export function SidebarAccountSkeleton() {
  return (
    <div className={ACCOUNT_BLOCK_CLASS} aria-hidden="true">
      <div className="flex min-w-0 items-center gap-2">
        <Skeleton className="size-7 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-col">
          <div className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-28" />
          </div>
          <div className="flex h-4 items-center">
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
      </div>
      {/* A badge's footprint: `text-xs` inside `py-0.5` and a 1px border. */}
      <div className="inline-flex w-fit rounded-full border border-transparent px-2 py-0.5">
        <Skeleton className="h-4 w-20 rounded-full" />
      </div>
      {/* The account link: a `py-2` nav entry around a 20px line. */}
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-8 w-full rounded-md" />
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
