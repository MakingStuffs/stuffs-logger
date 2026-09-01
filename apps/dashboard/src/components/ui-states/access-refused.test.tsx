import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";

import { AccessRefused, resolveAccess } from "./access-refused";

describe("resolveAccess", () => {
  it("returns what the read produced when it is allowed", async () => {
    const outcome = await resolveAccess(async () => ["checkout"]);

    expect(outcome).toEqual({ allowed: true, data: ["checkout"] });
  });

  it("turns the gate's refusal of a non-internal viewer into an outcome", async () => {
    const outcome = await resolveAccess(() => {
      throw new ApiError(
        "FORBIDDEN",
        "Only Making Stuffs staff can use stuffs-logger.",
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
  it("tells a non-internal viewer the tool is staff-only, not broken", () => {
    render(<AccessRefused code="FORBIDDEN" />);

    expect(
      screen.getByRole("heading", { name: "Making Stuffs staff only" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/internal engineering tool/i)).toBeInTheDocument();
  });

  it("tells a non-internal viewer what to do next", () => {
    render(<AccessRefused code="FORBIDDEN" />);

    expect(
      screen.getByText(/ask whoever runs Stuffs Logger to check its scope/i),
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
