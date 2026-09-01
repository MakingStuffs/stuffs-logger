import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";

import { AccessRefused, resolveAccess } from "./access-refused";

describe("resolveAccess", () => {
  it("returns what the read produced when it is allowed", async () => {
    const outcome = await resolveAccess(async () => ["checkout"]);

    expect(outcome).toEqual({ allowed: true, data: ["checkout"] });
  });

  it("turns the gate's refusal of a non-administrator into an outcome", async () => {
    const outcome = await resolveAccess(() => {
      throw new ApiError(
        "FORBIDDEN",
        "Only an administrator can manage ingest keys.",
      );
    });

    expect(outcome).toEqual({ allowed: false, code: "FORBIDDEN" });
  });

  it("turns the gate's refusal of a deactivated account into an outcome", async () => {
    const outcome = await resolveAccess(() => {
      throw new ApiError("UNAUTHORIZED", "Your account is no longer active.");
    });

    expect(outcome).toEqual({ allowed: false, code: "UNAUTHORIZED" });
  });

  it("rethrows an error that is not a refusal, so the error boundary keeps it", async () => {
    await expect(
      resolveAccess(() => {
        throw new ApiError("INTERNAL_ERROR", "The database is unreachable.");
      }),
    ).rejects.toThrow("The database is unreachable.");
  });

  it("rethrows a control-flow signal such as notFound(), never swallowing it", async () => {
    const signal = new Error("NEXT_HTTP_ERROR_FALLBACK;404");

    await expect(
      resolveAccess(() => {
        throw signal;
      }),
    ).rejects.toBe(signal);
  });
});

describe("AccessRefused", () => {
  it("tells a member that key management is closed, not broken", () => {
    render(<AccessRefused code="FORBIDDEN" />);

    expect(
      screen.getByRole("heading", { name: "Administrators only" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/live write credential/i)).toBeInTheDocument();
  });

  it("does not suggest a member has lost access to the logs they can still read", () => {
    render(<AccessRefused code="FORBIDDEN" />);

    expect(
      screen.getByText(/can read every application's logs/i),
    ).toBeInTheDocument();
  });

  it("tells a member what to do next", () => {
    render(<AccessRefused code="FORBIDDEN" />);

    expect(
      screen.getByText(/ask an administrator to do it or to change your role/i),
    ).toBeInTheDocument();
  });

  it("tells a deactivated account why it can no longer read anything", () => {
    render(<AccessRefused code="UNAUTHORIZED" />);

    expect(
      screen.getByRole("heading", { name: "Your account is no longer active" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/deactivated/i)).toBeInTheDocument();
  });
});
