import { render, screen } from "@testing-library/react";
import { Boxes, LayoutDashboard, ScrollText } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppSidebar } from "./sidebar-nav";
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

function renderSidebar(props: Partial<Parameters<typeof AppSidebar>[0]> = {}) {
  return render(
    <AppSidebar appName="Stuffs Logger" links={LINKS} {...props} />,
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

  it("shows who is signed in", () => {
    renderSidebar({ user: makeUser() });

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@makingstuffs.test")).toBeInTheDocument();
  });

  it("shows what the account may do, so a refusal elsewhere makes sense", () => {
    renderSidebar({ user: makeUser({ role: "Administrator" }) });

    expect(screen.getByText("Administrator")).toBeInTheDocument();
  });

  it("renders no account block when nobody is signed in", () => {
    renderSidebar();

    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("offers a way out when the app supplies one", () => {
    renderSidebar({ user: makeUser(), signOutAction: vi.fn() });

    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });

  it("signs out through a form, not a link, so it cannot be triggered by a URL", () => {
    renderSidebar({ user: makeUser(), signOutAction: vi.fn() });

    expect(screen.getByRole("button", { name: /sign out/i })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("offers no sign-out when the app supplies no handler", () => {
    renderSidebar({ user: makeUser() });

    expect(
      screen.queryByRole("button", { name: /sign out/i }),
    ).not.toBeInTheDocument();
  });
});
