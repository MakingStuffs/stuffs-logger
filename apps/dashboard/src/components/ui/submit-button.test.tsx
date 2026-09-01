import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SubmitButton } from "./submit-button";

describe("SubmitButton", () => {
  it("is usable while the form is idle", () => {
    render(
      <SubmitButton type="submit" isPending={false}>
        Create key
      </SubmitButton>,
    );

    expect(screen.getByRole("button", { name: "Create key" })).toBeEnabled();
  });

  it("disables itself while the action is in flight, so it cannot double-submit", () => {
    render(
      <SubmitButton type="submit" isPending>
        Creating…
      </SubmitButton>,
    );

    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  });

  it("stays disabled when the caller disabled it and nothing is pending", () => {
    render(
      <SubmitButton type="submit" isPending={false} disabled>
        Create key
      </SubmitButton>,
    );

    expect(screen.getByRole("button", { name: "Create key" })).toBeDisabled();
  });

  it("does not announce the spinner, which repeats what the label already says", () => {
    render(
      <SubmitButton type="submit" isPending>
        Creating…
      </SubmitButton>,
    );

    expect(screen.getByRole("button")).toHaveAccessibleName("Creating…");
  });
});
