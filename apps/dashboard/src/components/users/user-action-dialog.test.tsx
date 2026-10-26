import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { UserAction, UserActionResult } from "@/lib/users/action-result";

import { UserActionDialog } from "./user-action-dialog";
import type { UserActionDialogProps } from "./user-action-dialog";

const EMAIL = "bo@example.test";

function makeAction(result: UserActionResult) {
  return vi.fn<UserAction>().mockResolvedValue(result);
}

function renderDialog(overrides: Partial<UserActionDialogProps> = {}) {
  const props: UserActionDialogProps = {
    action: makeAction({ status: "updated", message: "done" }),
    userId: "user-2",
    userEmail: EMAIL,
    triggerLabel: "Deactivate",
    title: "Deactivate Bo?",
    description: "They are signed out everywhere.",
    submitLabel: "Confirm deactivate",
    pendingLabel: "Deactivating…",
    requireEmailConfirmation: true,
    ...overrides,
  };
  render(<UserActionDialog {...props} />);
  return props;
}

describe("UserActionDialog", () => {
  it("names the row it acts on, so two rows' buttons are distinguishable", () => {
    renderDialog();

    expect(
      screen.getByRole("button", { name: `Deactivate ${EMAIL}` }),
    ).toBeInTheDocument();
  });

  it("submits the target id and retyped address, then closes on success", async () => {
    const user = userEvent.setup();
    const { action } = renderDialog();

    await user.click(
      screen.getByRole("button", { name: `Deactivate ${EMAIL}` }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/type the user.s email address/i),
      EMAIL,
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm deactivate" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const submitted = vi.mocked(action).mock.calls[0]?.[1];
    expect(submitted?.get("userId")).toBe("user-2");
    expect(submitted?.get("confirmEmail")).toBe(EMAIL);
  });

  it("stays open and names a confirmation mismatch", async () => {
    const user = userEvent.setup();
    renderDialog({
      action: makeAction({
        status: "error",
        message: "The address you typed does not match this user.",
        fieldErrors: {
          confirmEmail: ["Type the user's email address exactly."],
        },
      }),
    });

    await user.click(
      screen.getByRole("button", { name: `Deactivate ${EMAIL}` }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/type the user.s email address/i),
      "wrong@example.test",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm deactivate" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Type the user's email address exactly.",
    );
  });

  it("shows a guard refusal without closing", async () => {
    const user = userEvent.setup();
    renderDialog({
      requireEmailConfirmation: false,
      hiddenFields: { role: "MEMBER" },
      action: makeAction({
        status: "error",
        message: "This is the last active administrator.",
      }),
    });

    await user.click(
      screen.getByRole("button", { name: `Deactivate ${EMAIL}` }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm deactivate" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "last active administrator",
    );
  });

  it("sends the hidden fields it was given", async () => {
    const user = userEvent.setup();
    const { action } = renderDialog({
      requireEmailConfirmation: false,
      hiddenFields: { role: "ADMIN" },
    });

    await user.click(
      screen.getByRole("button", { name: `Deactivate ${EMAIL}` }),
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm deactivate" }),
    );

    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(vi.mocked(action).mock.calls[0]?.[1].get("role")).toBe("ADMIN");
  });

  it("shows an issued password once", async () => {
    const user = userEvent.setup();
    renderDialog({
      action: makeAction({
        status: "password_issued",
        email: EMAIL,
        mode: "reset",
        temporaryPassword: "Zq3_temporary-Password_9",
      }),
    });

    await user.click(
      screen.getByRole("button", { name: `Deactivate ${EMAIL}` }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/type the user.s email address/i),
      EMAIL,
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm deactivate" }),
    );

    expect(
      await within(dialog).findByText("Zq3_temporary-Password_9"),
    ).toBeVisible();
    expect(within(dialog).getByText("Password reset")).toBeVisible();
  });
});
