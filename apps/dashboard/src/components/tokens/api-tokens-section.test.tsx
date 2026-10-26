import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiTokenSummary } from "@/lib/tokens/dto";

import { ApiTokensSection } from "./api-tokens-section";

// The actions module reaches the database client at import time, which has no
// place in a rendering test; what the dialogs submit is the actions' suite.
vi.mock("@/lib/tokens/actions", () => ({
  createApiTokenAction: vi.fn(),
  revokeApiTokenAction: vi.fn(),
}));

function makeToken(overrides: Partial<ApiTokenSummary> = {}): ApiTokenSummary {
  return {
    id: "token-1",
    name: "Retention cron",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: "2026-01-15T03:00:01.000Z",
    revokedAt: null,
    ...overrides,
  };
}

describe("ApiTokensSection", () => {
  it("offers to create the first token when there are none", () => {
    render(<ApiTokensSection tokens={[]} />);

    expect(screen.getByText("No API tokens yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create token" }),
    ).toBeInTheDocument();
  });

  it("names the endpoint that consumes tokens and the hourly limit", () => {
    render(<ApiTokensSection tokens={[]} />);

    const note = screen.getByRole("complementary", {
      name: "What uses these tokens",
    });
    expect(note).toHaveTextContent("GET /api/cron/retention");
    expect(note).toHaveTextContent("03:00 UTC");
    expect(note).toHaveTextContent("Authorization: Bearer <token>");
    expect(note).toHaveTextContent("at most once an hour");
  });

  it("lists an active token with a revoke control", () => {
    render(<ApiTokensSection tokens={[makeToken()]} />);

    const row = screen.getByRole("row", { name: /Retention cron/ });
    expect(within(row).getByText("Active")).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Revoke Retention cron" }),
    ).toBeInTheDocument();
  });

  it("lists a revoked token without a revoke control", () => {
    render(
      <ApiTokensSection
        tokens={[makeToken({ revokedAt: "2026-02-01T00:00:00.000Z" })]}
      />,
    );

    const row = screen.getByRole("row", { name: /Retention cron/ });
    expect(within(row).getByText("Revoked")).toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });

  it("says Never for a token that has not been used", () => {
    render(<ApiTokensSection tokens={[makeToken({ lastUsedAt: null })]} />);

    expect(
      within(screen.getByRole("row", { name: /Retention cron/ })).getByText(
        "Never",
      ),
    ).toBeInTheDocument();
  });

  it("heads the usage column 'Last used' and nothing more", () => {
    render(<ApiTokensSection tokens={[makeToken()]} />);

    expect(
      screen.getByRole("columnheader", { name: "Last used" }),
    ).toBeInTheDocument();
  });
});
