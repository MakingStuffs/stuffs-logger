import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApplicationsEmptyState } from "./applications-empty-state";

describe("ApplicationsEmptyState", () => {
  it("points an administrator at the control that creates one", () => {
    render(<ApplicationsEmptyState isAdmin />);

    expect(screen.getByText(/New application above/)).toBeInTheDocument();
  });

  it("tells a member to ask an administrator", () => {
    render(<ApplicationsEmptyState isAdmin={false} />);

    expect(screen.getByText(/Ask one to set it up/)).toBeInTheDocument();
    expect(screen.queryByText(/New application/)).not.toBeInTheDocument();
  });

  it("no longer tells anyone to register an application in the database", () => {
    render(<ApplicationsEmptyState isAdmin />);

    expect(screen.queryByText(/database/i)).not.toBeInTheDocument();
  });
});
