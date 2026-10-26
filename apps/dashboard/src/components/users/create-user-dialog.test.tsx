import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { UserAction, UserActionResult } from "@/lib/users/action-result";

import { CreateUserDialog } from "./create-user-dialog";

/**
 * The add-user dialog, driven through the action it is GIVEN. It receives the
 * action as a prop (never importing the `"use server"` module), so a stub is
 * the real seam rather than a module mock.
 */

const TEMPORARY_PASSWORD = "Zq3_temporary-Password_9";

function makeAction(result: UserActionResult) {
  return vi.fn<UserAction>().mockResolvedValue(result);
}

async function openAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Add user" }));
  const dialog = screen.getByRole("dialog");

  await user.type(within(dialog).getByLabelText("Name"), "Ada Lovelace");
  await user.type(within(dialog).getByLabelText("Email"), "ada@example.test");
  await user.selectOptions(
    within(dialog).getByLabelText("Role"),
    "Administrator",
  );
  await user.click(within(dialog).getByRole("button", { name: "Add user" }));

  return dialog;
}

describe("CreateUserDialog", () => {
  it("submits name, email and role through the action it was given", async () => {
    const user = userEvent.setup();
    const action = makeAction({ status: "error", message: "nope" });
    render(<CreateUserDialog action={action} />);

    await openAndSubmit(user);

    const submitted = action.mock.calls[0]?.[1];
    expect(submitted?.get("name")).toBe("Ada Lovelace");
    expect(submitted?.get("email")).toBe("ada@example.test");
    expect(submitted?.get("role")).toBe("ADMIN");
  });

  it("shows the temporary password once, with the private-channel note", async () => {
    const user = userEvent.setup();
    render(
      <CreateUserDialog
        action={makeAction({
          status: "created",
          name: "Ada Lovelace",
          email: "ada@example.test",
          temporaryPassword: TEMPORARY_PASSWORD,
        })}
      />,
    );

    const dialog = await openAndSubmit(user);

    expect(await within(dialog).findByText(TEMPORARY_PASSWORD)).toBeVisible();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /private channel/i,
    );
  });

  it("forgets the password when the dialog closes", async () => {
    const user = userEvent.setup();
    render(
      <CreateUserDialog
        action={makeAction({
          status: "created",
          name: "Ada Lovelace",
          email: "ada@example.test",
          temporaryPassword: TEMPORARY_PASSWORD,
        })}
      />,
    );

    const dialog = await openAndSubmit(user);
    await user.click(
      await within(dialog).findByRole("button", { name: "Done" }),
    );
    await user.click(screen.getByRole("button", { name: "Add user" }));

    expect(screen.queryByText(TEMPORARY_PASSWORD)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("names a duplicate address on the email field", async () => {
    const user = userEvent.setup();
    render(
      <CreateUserDialog
        action={makeAction({
          status: "error",
          message: "Someone already has that email address.",
          fieldErrors: {
            email: ["A user with this email address already exists."],
          },
        })}
      />,
    );

    const dialog = await openAndSubmit(user);

    expect(
      await within(dialog).findByText(
        "A user with this email address already exists.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByLabelText("Email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
