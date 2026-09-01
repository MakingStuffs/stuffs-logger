import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApplicationSummary, IngestKeySummary } from "@/lib/logs/dto";

import { IngestKeysSection } from "./ingest-keys-section";

// The actions module reaches for the database client at import time, which has
// no place in a rendering test. The dialogs are exercised for their markup, not
// for what they submit — that is the actions' own suite.
vi.mock("@/lib/apps/actions", () => ({
  createIngestKeyAction: vi.fn(),
  revokeIngestKeyAction: vi.fn(),
}));

const APPLICATION: ApplicationSummary = {
  id: "app-1",
  slug: "checkout",
  name: "Checkout",
  description: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function makeKey(overrides: Partial<IngestKeySummary> = {}): IngestKeySummary {
  return {
    id: "key-1",
    applicationId: "app-1",
    name: "Checkout — production",
    type: "PUBLIC",
    publicKey: "jfl_pub_abc123",
    allowedOrigins: ["https://shop.example.test"],
    revokedAt: null,
    lastUsedAt: "2026-01-15T09:31:04.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderSection(keys: IngestKeySummary[]) {
  return render(<IngestKeysSection application={APPLICATION} keys={keys} />);
}

describe("IngestKeysSection", () => {
  it("welcomes an application that has no keys yet", () => {
    renderSection([]);

    expect(screen.getByText("No ingest keys yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create key/i }),
    ).toBeInTheDocument();
  });

  it("shows a browser key's value, which is designed to be public", () => {
    renderSection([makeKey()]);

    expect(screen.getByText("jfl_pub_abc123")).toBeInTheDocument();
  });

  it("lists the origin allowlist that protects a browser key", () => {
    renderSection([makeKey()]);

    expect(screen.getByText("https://shop.example.test")).toBeInTheDocument();
  });

  it("never shows a server key's value, only that it was shown once", () => {
    renderSection([
      makeKey({
        type: "SECRET",
        publicKey: null,
        allowedOrigins: [],
        name: "Batch importer",
      }),
    ]);

    expect(screen.getByText("Shown once at creation")).toBeInTheDocument();
    expect(screen.getByText("Not origin-bound")).toBeInTheDocument();
  });

  it("offers to revoke a live key", () => {
    renderSection([makeKey()]);

    expect(screen.getByRole("button", { name: /revoke/i })).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("marks a revoked key and offers no second revocation", () => {
    renderSection([makeKey({ revokedAt: "2026-01-16T00:00:00.000Z" })]);

    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^revoke/i }),
    ).not.toBeInTheDocument();
  });

  it("says when a key has never been used", () => {
    renderSection([makeKey({ lastUsedAt: null })]);

    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("labels every column of the key table", () => {
    renderSection([makeKey()]);

    expect(
      screen.getByRole("columnheader", { name: "Allowed origins" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Last used (UTC)" }),
    ).toBeInTheDocument();
  });
});
