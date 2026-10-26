import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ApplicationActionResult } from "@/lib/apps/application-actions";

import type { ApplicationAction } from "./application-action";
import { DeleteApplicationDialog } from "./delete-application-dialog";

const APPLICATION = { id: "app-1", slug: "billing", name: "Billing" };

function makeAction(result: ApplicationActionResult) {
  return vi.fn<ApplicationAction>().mockResolvedValue(result);
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Delete application" }));
  return screen.getByRole("dialog");
}

async function confirmWith(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  typed: string,
) {
  await user.type(
    within(dialog).getByLabelText(/type the application.s slug to confirm/i),
    typed,
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Delete permanently" }),
  );
}

describe("DeleteApplicationDialog", () => {
  it("states plainly that every log line and key is deleted for good", async () => {
    const user = userEvent.setup();
    render(
      <DeleteApplicationDialog
        action={makeAction({ status: "idle" })}
        application={APPLICATION}
      />,
    );

    const dialog = await openDialog(user);

    expect(
      within(dialog).getByRole("heading", { name: "Delete Billing?" }),
    ).toBeInTheDocument();
    const warning = within(dialog).getByText(/permanently deletes/);
    expect(warning).toHaveTextContent("every ingest key");
    expect(warning).toHaveTextContent("every log line");
    expect(warning).toHaveTextContent("stops being able to log");
    expect(warning).toHaveTextContent("cannot be undone");
  });

  it("submits the retyped slug through the action it was given", async () => {
    const user = userEvent.setup();
    const action = makeAction({ status: "idle" });
    render(
      <DeleteApplicationDialog action={action} application={APPLICATION} />,
    );

    const dialog = await openDialog(user);
    await confirmWith(user, dialog, "billing");

    const submitted = action.mock.calls[0]?.[1];
    expect(submitted?.get("applicationId")).toBe("app-1");
    expect(submitted?.get("confirmSlug")).toBe("billing");
  });

  it("stays open and names the mismatch when the action refuses", async () => {
    const user = userEvent.setup();
    render(
      <DeleteApplicationDialog
        action={makeAction({
          status: "error",
          message: "The slug you typed does not match this application.",
          fieldErrors: {
            confirmSlug: ["Type the application's slug exactly."],
          },
        })}
        application={APPLICATION}
      />,
    );

    const dialog = await openDialog(user);
    await confirmWith(user, dialog, "Billing");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Type the application's slug exactly.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the retry message when the delete ran out of time", async () => {
    const user = userEvent.setup();
    render(
      <DeleteApplicationDialog
        action={makeAction({
          status: "error",
          message:
            "This application has more log lines than one request can delete. The ones already removed stay removed — delete it again to carry on.",
        })}
        application={APPLICATION}
      />,
    );

    const dialog = await openDialog(user);
    await confirmWith(user, dialog, "billing");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "delete it again to carry on",
    );
  });
});
