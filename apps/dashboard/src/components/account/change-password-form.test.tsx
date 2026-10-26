import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  AccountAction,
  AccountActionResult,
} from "@/lib/users/action-result";

import { ChangePasswordForm } from "./change-password-form";

function makeAction(result: AccountActionResult) {
  return vi.fn<AccountAction>().mockResolvedValue(result);
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Current password"), "old-password-1");
  await user.type(screen.getByLabelText("New password"), "new-password-123");
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "new-password-123",
  );
  await user.click(screen.getByRole("button", { name: "Change password" }));
}

describe("ChangePasswordForm", () => {
  it("uses password fields with the right autocomplete hints", () => {
    render(<ChangePasswordForm action={makeAction({ status: "idle" })} />);

    expect(screen.getByLabelText("Current password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "minlength",
      "12",
    );
  });

  it("submits the three fields through the action it was given", async () => {
    const user = userEvent.setup();
    const action = makeAction({ status: "success", message: "Changed." });
    render(<ChangePasswordForm action={action} />);

    await fillAndSubmit(user);

    const submitted = action.mock.calls[0]?.[1];
    expect(submitted?.get("currentPassword")).toBe("old-password-1");
    expect(submitted?.get("newPassword")).toBe("new-password-123");
    expect(submitted?.get("confirmPassword")).toBe("new-password-123");
    expect(await screen.findByRole("status")).toHaveTextContent("Changed.");
  });

  it("shows the generic failure", async () => {
    const user = userEvent.setup();
    render(
      <ChangePasswordForm
        action={makeAction({
          status: "error",
          message: "Your password was not changed.",
        })}
      />,
    );

    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your password was not changed.",
    );
  });
});
