import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ApplicationActivity, ApplicationSummary } from "@/lib/logs/dto";

import { ApplicationActivityCards } from "./application-activity-cards";

const APPLICATION: ApplicationSummary = {
  id: "app-1",
  slug: "checkout",
  name: "Checkout",
  description: "The basket and payment journey",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderCards(activity: ApplicationActivity[]) {
  return render(
    <ApplicationActivityCards
      applications={[APPLICATION]}
      activity={activity}
    />,
  );
}

describe("ApplicationActivityCards", () => {
  it("shows an application's volume and error count", () => {
    renderCards([
      {
        applicationId: "app-1",
        applicationSlug: "checkout",
        applicationName: "Checkout",
        eventCount: 1200,
        errorCount: 24,
      },
    ]);

    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("2.0%")).toBeInTheDocument();
  });

  it("shows a quiet application as a deliberate zero", () => {
    renderCards([]);

    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("links through to the application's log stream", () => {
    renderCards([]);

    expect(
      screen.getByRole("link", { name: /view logs for checkout/i }),
    ).toHaveAttribute("href", "/logs?applicationSlug=checkout");
  });

  it("links straight to the errors when there are any", () => {
    renderCards([
      {
        applicationId: "app-1",
        applicationSlug: "checkout",
        applicationName: "Checkout",
        eventCount: 100,
        errorCount: 4,
      },
    ]);

    expect(
      screen.getByRole("link", { name: /view errors for checkout/i }),
    ).toHaveAttribute(
      "href",
      "/logs?applicationSlug=checkout&level=error&level=fatal",
    );
  });

  it("offers no errors link when nothing failed", () => {
    renderCards([]);

    expect(
      screen.queryByRole("link", { name: /view errors/i }),
    ).not.toBeInTheDocument();
  });
});
