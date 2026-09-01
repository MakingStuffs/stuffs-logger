import { Boxes, LayoutDashboard, ScrollText } from "lucide-react";

import pkg from "../../package.json";

import { signOutAction } from "@/app/sign-out/actions";
import { APP_DISPLAY_NAME } from "@/constants/environment";
import type { UserRole } from "@/lib/auth/types";

import { Footer } from "./shell/footer";
import { AppSidebar } from "./shell/sidebar-nav";
import type { BasicLink } from "./shell/sidebar-nav";
import { SidebarProvider } from "./ui/sidebar";

/**
 * The user fields the chrome shows.
 *
 * Structurally compatible with the resolved session user, so a page passes
 * `session.user` straight in — and deliberately narrower than that type,
 * because the chrome has no business holding an id or a session token.
 */
export interface ShellUser {
  name?: string | null;
  email?: string | null;
  role?: UserRole | null;
}

interface AppShellProps {
  children: React.ReactNode;
  user?: ShellUser;
}

/**
 * The sections of the app.
 *
 * Every entry is offered to every signed-in account, because every signed-in
 * account may read logs. Ingest keys — the one thing an administrator can do
 * and a member cannot — are not a section of their own: they live inside an
 * application's page, which gates them itself and renders its own refusal. So
 * there is nothing here to filter by role, and no hidden entry that could be
 * mistaken for a permission check.
 */
const LINKS: BasicLink[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Logs", href: "/logs", icon: ScrollText },
  { label: "Applications", href: "/apps", icon: Boxes },
];

/** How each role is described to the person holding it. */
const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  ADMIN: "Administrator",
  MEMBER: "Member",
};

/**
 * The app chrome: navigation, page content and the footer.
 *
 * Pages render their own {@link AppHeader} inside `children`, so the chrome
 * never has to know what page it is wrapping.
 *
 * Holds no auth logic. The page rendering it has already gated itself and
 * passes down only the fields the sidebar displays — showing a name is not an
 * access decision, and nothing here is treated as one.
 *
 * Entirely server-rendered: the only client code in the chrome is the leaf
 * that marks the current navigation entry.
 */
export function AppShell({ children, user }: AppShellProps) {
  // The session guarantees an email; a display name is best effort, so it
  // falls back to the address rather than rendering an empty label.
  const sidebarUser = user?.email
    ? {
        name: user.name ?? user.email,
        email: user.email,
        ...(user.role ? { role: ROLE_LABELS[user.role] } : {}),
      }
    : undefined;

  return (
    <SidebarProvider>
      <AppSidebar
        appName={APP_DISPLAY_NAME}
        links={LINKS}
        user={sidebarUser}
        signOutAction={signOutAction}
      />
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
