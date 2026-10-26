import { render, screen } from "@testing-library/react";
import {
  Boxes,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  Users,
} from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppSidebar, SidebarAccount, SidebarNavGroup } from "./sidebar-nav";
import type { BasicLink, SidebarUser } from "./sidebar-nav";

// `usePathname` is the one browser-only dependency in the chrome. Mocking the
// router module is mocking a boundary, not the component's own collaborators.
const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname }));

const LINKS: BasicLink[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Logs", href: "/logs", icon: ScrollText },
  { label: "Applications", href: "/apps", icon: Boxes },
];

function makeUser(overrides: Partial<SidebarUser> = {}): SidebarUser {
  return {
    name: "Ada Lovelace",
    email: "ada@makingstuffs.test",
    ...overrides,
  };
}

/**
 * The rail, with whatever belongs at its foot. The account block is passed as
 * a child rather than as props because that is how the layout renders it: as
 * its own streamed boundary, so the navigation never waits on a session read.
 */
function renderSidebar(children?: React.ReactNode) {
  return render(
    <AppSidebar appName="Stuffs Logger" links={LINKS}>
      {children}
    </AppSidebar>,
  );
}

beforeEach(() => {
  usePathname.mockReturnValue("/");
});

describe("AppSidebar", () => {
  it("offers every section as a real link", () => {
    renderSidebar();

    const nav = screen.getByRole("navigation", { name: "Main" });

    expect(screen.getByRole("link", { name: /logs/i })).toHaveAttribute(
      "href",
      "/logs",
    );
    expect(nav).toContainElement(screen.getByRole("link", { name: /logs/i }));
  });

  it("marks the section the reader is in", () => {
    usePathname.mockReturnValue("/logs");
    renderSidebar();

    expect(screen.getByRole("link", { name: /logs/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps the section marked on a page nested inside it", () => {
    usePathname.mockReturnValue("/logs/abc123");
    renderSidebar();

    expect(screen.getByRole("link", { name: /logs/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks only one section at a time", () => {
    usePathname.mockReturnValue("/logs");
    renderSidebar();

    expect(
      screen.getByRole("link", { name: /applications/i }),
    ).not.toHaveAttribute("aria-current");
  });

  it("renders no account block when none is supplied", () => {
    renderSidebar();

    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sign out/i }),
    ).not.toBeInTheDocument();
  });
});

describe("SidebarAccount", () => {
  it("shows who is signed in", () => {
    renderSidebar(<SidebarAccount user={makeUser()} />);

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@makingstuffs.test")).toBeInTheDocument();
  });

  it("shows what the account may do, so a refusal elsewhere makes sense", () => {
    renderSidebar(
      <SidebarAccount user={makeUser({ role: "Administrator" })} />,
    );

    expect(screen.getByText("Administrator")).toBeInTheDocument();
  });

  it("offers a way out when the app supplies one", () => {
    renderSidebar(<SidebarAccount user={makeUser()} signOutAction={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });

  it("signs out through a form, not a link, so it cannot be triggered by a URL", () => {
    renderSidebar(<SidebarAccount user={makeUser()} signOutAction={vi.fn()} />);

    expect(screen.getByRole("button", { name: /sign out/i })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("offers no sign-out when the app supplies no handler", () => {
    renderSidebar(<SidebarAccount user={makeUser()} />);

    expect(
      screen.queryByRole("button", { name: /sign out/i }),
    ).not.toBeInTheDocument();
  });
});

describe("SidebarNavGroup", () => {
  const ADMIN_LINKS: BasicLink[] = [
    { label: "Users", href: "/users", icon: Users },
    { label: "API tokens", href: "/tokens", icon: KeyRound },
  ];

  it("is its own navigation landmark, named by its heading", () => {
    render(
      <AppSidebar
        appName="Stuffs Logger"
        links={LINKS}
        secondaryNav={
          <SidebarNavGroup label="Administration" links={ADMIN_LINKS} />
        }
      />,
    );

    const group = screen.getByRole("navigation", { name: "Administration" });

    expect(group).toContainElement(
      screen.getByRole("link", { name: /users/i }),
    );
    expect(screen.getByRole("link", { name: /api tokens/i })).toHaveAttribute(
      "href",
      "/tokens",
    );
  });

  it("leaves the main navigation's entries where they were", () => {
    render(
      <AppSidebar
        appName="Stuffs Logger"
        links={LINKS}
        secondaryNav={
          <SidebarNavGroup label="Administration" links={ADMIN_LINKS} />
        }
      />,
    );

    expect(screen.queryByRole("link", { name: /users/i })).not.toBeNull();
    expect(
      screen.getByRole("navigation", { name: "Main" }),
    ).not.toContainElement(screen.getByRole("link", { name: /users/i }));
  });

  it("marks the admin section the reader is in", () => {
    usePathname.mockReturnValue("/users");
    render(<SidebarNavGroup label="Administration" links={ADMIN_LINKS} />);

    expect(screen.getByRole("link", { name: /users/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("SidebarAccount — account link", () => {
  it("offers the account page when the app supplies one", () => {
    renderSidebar(
      <SidebarAccount
        user={makeUser()}
        accountHref="/account"
        signOutAction={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/account",
    );
    // Still a form button, unchanged, beside it.
    expect(screen.getByRole("button", { name: /sign out/i })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("offers no account link when none is supplied", () => {
    renderSidebar(<SidebarAccount user={makeUser()} />);

    expect(
      screen.queryByRole("link", { name: "Account" }),
    ).not.toBeInTheDocument();
  });
});
