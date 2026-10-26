import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ApplicationActionResult } from "@/lib/apps/application-actions";

import type { ApplicationAction } from "./application-action";
import { EditApplicationDialog } from "./edit-application-dialog";

const APPLICATION = {
  id: "app-1",
  slug: "billing",
  name: "Billing",
  description: "Invoices.",
};

function makeAction(result: ApplicationActionResult) {
  return vi.fn<ApplicationAction>().mockResolvedValue(result);
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Edit details" }));
  return screen.getByRole("dialog");
}

describe("EditApplicationDialog", () => {
  it("starts from the saved name and description", async () => {
    const user = userEvent.setup();
    render(
      <EditApplicationDialog
        action={makeAction({ status: "idle" })}
        application={APPLICATION}
      />,
    );

    const dialog = await openDialog(user);

    expect(within(dialog).getByLabelText("Name")).toHaveValue("Billing");
    expect(within(dialog).getByLabelText(/description/i)).toHaveValue(
      "Invoices.",
    );
  });

  it("shows the slug read-only, says why, and never submits it", async () => {
    const user = userEvent.setup();
    const action = makeAction({ status: "updated", name: "Billing" });
    render(<EditApplicationDialog action={action} application={APPLICATION} />);

    const dialog = await openDialog(user);
    const slug = within(dialog).getByLabelText("Slug");

    expect(slug).toHaveValue("billing");
    expect(slug).toHaveAttribute("readonly");
    expect(slug).toHaveAccessibleDescription(/slug cannot be changed/i);

    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(action.mock.calls[0]?.[1].has("slug")).toBe(false);
  });

  it("submits the edits through the action it was given, and closes on success", async () => {
    const user = userEvent.setup();
    const action = makeAction({ status: "updated", name: "Billing service" });
    render(<EditApplicationDialog action={action} application={APPLICATION} />);

    const dialog = await openDialog(user);
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Billing service");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const submitted = action.mock.calls[0]?.[1];
    expect(submitted?.get("applicationId")).toBe("app-1");
    expect(submitted?.get("name")).toBe("Billing service");
    expect(submitted?.get("description")).toBe("Invoices.");
  });

  it("stays open with the field error when the action refuses", async () => {
    const user = userEvent.setup();
    render(
      <EditApplicationDialog
        action={makeAction({
          status: "error",
          message: "Check the details and try again.",
          fieldErrors: { name: ["Give the application a name."] },
        })}
        application={APPLICATION}
      />,
    );

    const dialog = await openDialog(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Give the application a name.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
