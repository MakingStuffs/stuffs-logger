import {
  Boxes,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  Users,
} from "lucide-react";
import { Suspense } from "react";

import pkg from "../../../package.json";

import { signOutAction } from "@/app/sign-out/actions";
import { Footer } from "@/components/shell/footer";
import {
  AppSidebar,
  SidebarAccount,
  SidebarAccountSkeleton,
  SidebarNavGroup,
} from "@/components/shell/sidebar-nav";
import type { BasicLink } from "@/components/shell/sidebar-nav";
import { SidebarProvider } from "@/components/ui/sidebar";
import { APP_DISPLAY_NAME } from "@/constants/environment";
import { isAdminUser } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import type { UserRole } from "@/lib/auth/types";

/**
 * The sections of the app every signed-in account is offered, because every
 * signed-in account may read logs.
 */
const LINKS: BasicLink[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Logs", href: "/logs", icon: ScrollText },
  { label: "Applications", href: "/apps", icon: Boxes },
];

/**
 * The sections only an administrator is offered.
 *
 * HIDING THESE IS PRESENTATION, NOT A PERMISSION CHECK. A member who types
 * `/users` gets that page's own `AccessRefused` state, and every action and
 * read behind it re-checks the role; the rail simply does not advertise
 * screens that would only refuse them.
 */
const ADMIN_LINKS: BasicLink[] = [
  { label: "Users", href: "/users", icon: Users },
  { label: "API tokens", href: "/tokens", icon: KeyRound },
];

/** Where every signed-in user manages their own account. */
const ACCOUNT_HREF = "/account";

/** How each role is described to the person holding it. */
const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  ADMIN: "Administrator",
  MEMBER: "Member",
};

/**
 * The app chrome — navigation, the content column and the footer — rendered
 * ONCE, around every signed-in page.
 *
 * A layout rather than a per-page wrapper for two reasons the router cares
 * about. A layout is kept across client-side navigations, so moving between
 * sections swaps the page and leaves the rail, its scroll position and its
 * hydrated state alone instead of rendering the chrome again from scratch.
 * And a `loading.tsx` beneath a layout is what lets a dynamic route be
 * prefetched at all: without one the router skips the route, and every click
 * in the sidebar waits on a server round trip before anything moves.
 *
 * THIS LAYOUT GATES NOTHING. A layout does not re-run on client-side
 * navigation, so a session check that lived only here would be a check a
 * navigation can skip; every page under it calls `getSessionOrRedirect`
 * itself and every data-access function re-checks the session behind that.
 * The session is read here for display only: the account block — a name, an
 * address and a role label — and whether to offer the administrator group.
 * Neither is an access decision.
 *
 * THE ACCOUNT BLOCK IS STREAMED. Reading the session means reading the
 * request's cookies, which Next treats as runtime data: a layout that awaits
 * it in its own body blocks the whole navigation until it resolves and
 * suppresses the page's `loading.tsx` fallback. Inside its own `<Suspense>`
 * the rail paints at once with a placeholder of the same size, and the page
 * gate's own `getSession` call — memoised per request — is the one database
 * lookup both share.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar
        appName={APP_DISPLAY_NAME}
        links={LINKS}
        secondaryNav={
          // No placeholder: a member is never shown this group, so reserving
          // space for it would leave a gap in every member's rail.
          <Suspense fallback={null}>
            <AdminNav />
          </Suspense>
        }
      >
        <Suspense fallback={<SidebarAccountSkeleton />}>
          <SessionAccount />
        </Suspense>
      </AppSidebar>
      {/* `min-w-0` stops a wide log line stretching the whole layout instead
          of scrolling inside its own table; `flex-1` lets the content share
          the column with the footer rather than overflowing past it. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1">{children}</main>
        <Footer appName={APP_DISPLAY_NAME} appVersion={pkg.version} />
      </div>
    </SidebarProvider>
  );
}

/**
 * Who is signed in, for the foot of the rail.
 *
 * Reads the session for DISPLAY. A refused result still carries the session
 * when there is one — a deactivated account — and that account is shown too:
 * the person is signed in, the page they are on is telling them why it reads
 * nothing, and a rail that pretended nobody was there would contradict it.
 * With no session at all there is nothing to show; the page is already
 * redirecting them to sign in.
 */
async function SessionAccount() {
  const result = await getSession();
  const user = result.session?.user;
  if (user === undefined) return null;

  // The session guarantees an email; a display name is best effort, so it
  // falls back to the address rather than rendering an empty label.
  const name = user.name.trim().length > 0 ? user.name : user.email;

  return (
    <SidebarAccount
      user={{ name, email: user.email, role: ROLE_LABELS[user.role] }}
      signOutAction={signOutAction}
      accountHref={ACCOUNT_HREF}
    />
  );
}

/**
 * The administrator-only group, shown to a live ADMIN and to nobody else.
 *
 * Streamed for the same reason as the account block — it depends on the
 * session — and sharing its memoised lookup, so it costs no extra query.
 */
async function AdminNav() {
  const result = await getSession();
  if (!result.hasAccess || !isAdminUser(result.session)) return null;

  return <SidebarNavGroup label="Administration" links={ADMIN_LINKS} />;
}
