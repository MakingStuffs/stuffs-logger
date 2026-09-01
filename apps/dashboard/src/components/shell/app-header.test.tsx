import { render, screen } from "@testing-library/react";
import { ScrollText } from "lucide-react";
import { describe, expect, it } from "vitest";

import { AppHeader } from "./app-header";

describe("AppHeader", () => {
  it("renders the page's title as its one top-level heading", () => {
    render(<AppHeader header="Log explorer" icon={ScrollText} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Log explorer" }),
    ).toBeInTheDocument();
  });

  it("says what the page is for", () => {
    render(
      <AppHeader
        header="Log explorer"
        copy="Search and filter every log line."
        icon={ScrollText}
      />,
    );

    expect(
      screen.getByText("Search and filter every log line."),
    ).toBeInTheDocument();
  });

  it("puts page actions in a named toolbar", () => {
    render(
      <AppHeader header="Log explorer" icon={ScrollText}>
        <button type="button">Export</button>
      </AppHeader>,
    );

    const toolbar = screen.getByRole("navigation", { name: "Page actions" });

    expect(toolbar).toContainElement(
      screen.getByRole("button", { name: "Export" }),
    );
  });

  it("draws no toolbar for a page with no actions", () => {
    render(<AppHeader header="Log explorer" icon={ScrollText} />);

    expect(
      screen.queryByRole("navigation", { name: "Page actions" }),
    ).not.toBeInTheDocument();
  });

  it("offers the way back up from a nested page", () => {
    render(
      <AppHeader
        header="Log event"
        icon={ScrollText}
        breadcrumbs={[
          { label: "Log explorer", href: "/logs" },
          { label: "Event" },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Log explorer" })).toHaveAttribute(
      "href",
      "/logs",
    );
  });

  it("announces the last breadcrumb as the current page rather than a link", () => {
    render(
      <AppHeader
        header="Log event"
        icon={ScrollText}
        breadcrumbs={[
          { label: "Log explorer", href: "/logs" },
          { label: "Event" },
        ]}
      />,
    );

    expect(screen.getByText("Event")).toHaveAttribute("aria-current", "page");
    expect(
      screen.queryByRole("link", { name: "Event" }),
    ).not.toBeInTheDocument();
  });

  it("draws no breadcrumb trail for a top-level page", () => {
    render(<AppHeader header="Overview" icon={ScrollText} />);

    expect(
      screen.queryByRole("navigation", { name: "Breadcrumb" }),
    ).not.toBeInTheDocument();
  });
});
