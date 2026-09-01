import { Footer } from "@journey-further/salient-ui/components/footer";
import { AppSidebar } from "@journey-further/salient-ui/components/sidebar-nav";
import type { BasicLink } from "@journey-further/salient-ui/components/sidebar-nav/types";
import { SidebarProvider } from "@journey-further/salient-ui/ui/sidebar";

import pkg from "../../package.json";

import { APP_DISPLAY_NAME } from "@/constants/environment";
import { signOut } from "@/lib/auth/session";

/** Structurally compatible with the resolved session user. */
export interface ShellUser {
  name?: string | null;
  email?: string | null;
  scope?: string | null;
  image?: string | null;
}

interface AppShellProps {
  children: React.ReactNode;
  user?: ShellUser;
}

const LINKS: BasicLink[] = [
  { label: "Overview", href: "/", icon: "LayoutDashboard" },
  { label: "Logs", href: "/logs", icon: "ScrollText" },
  { label: "Applications", href: "/apps", icon: "Boxes" },
];

/**
 * The app chrome: sidebar, page content and the shared footer.
 *
 * Pages render their own AppHeader inside `children`, per the page-structure
 * spec. This component holds no auth logic — the page that renders it has
 * already gated itself and passes down only the user fields the sidebar needs.
 */
export function AppShell({ children, user }: AppShellProps) {
  // AppSidebar wants concrete strings; the session only guarantees an email.
  const sidebarUser = user?.email
    ? {
        name: user.name ?? user.email,
        email: user.email,
        scope: user.scope ?? "",
        signOutHandler: async () => {
          "use server";
          await signOut();
        },
        ...(user.image ? { image: user.image } : {}),
      }
    : undefined;

  return (
    <SidebarProvider>
      <AppSidebar links={LINKS} user={sidebarUser} />
      <div className="flex min-h-svh w-full flex-col">
        {/* The base layer gives main a min-height of its own; flex-1 lets it
            share the column with the footer instead of overflowing past it. */}
        <main className="min-h-0 flex-1">{children}</main>
        <Footer appName={APP_DISPLAY_NAME} appVersion={pkg.version} />
      </div>
    </SidebarProvider>
  );
}
