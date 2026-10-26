import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ApplicationActionResult } from "@/lib/apps/application-actions";

import type { ApplicationAction } from "./application-action";
import { CreateApplicationDialog } from "./create-application-dialog";

/**
 * Driven through the action it is GIVEN, as the ingest-key dialogs are: the
 * production action arrives as a prop from a server component, so a double
 * passed the same way needs no module mock at all.
 */

function makeAction(result: ApplicationActionResult) {
  return vi.fn<ApplicationAction>().mockResolvedValue(result);
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "New application" }));
  return screen.getByRole("dialog");
}

describe("CreateApplicationDialog", () => {
  it("suggests a slug from the name as it is typed", async () => {
    const user = userEvent.setup();
    render(<CreateApplicationDialog action={makeAction({ status: "idle" })} />);

    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText("Name"), "Billing Service");

    expect(within(dialog).getByLabelText("Slug")).toHaveValue(
      "billing-service",
    );
  });

  it("stops following the name once a slug is typed by hand", async () => {
    const user = userEvent.setup();
    render(<CreateApplicationDialog action={makeAction({ status: "idle" })} />);

    const dialog = await openDialog(user);
    const slug = within(dialog).getByLabelText("Slug");
    await user.type(within(dialog).getByLabelText("Name"), "Billing");
    await user.clear(slug);
    await user.type(slug, "payments");
    await user.type(within(dialog).getByLabelText("Name"), " Service");

    expect(slug).toHaveValue("payments");
  });

  it("submits the name, slug and description through the action it was given", async () => {
    const user = userEvent.setup();
    const action = makeAction({ status: "idle" });
    render(<CreateApplicationDialog action={action} />);

    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText("Name"), "Billing");
    await user.type(
      within(dialog).getByLabelText(/description/i),
      "Invoices and payment runs.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create application" }),
    );

    expect(action).toHaveBeenCalledTimes(1);
    const submitted = action.mock.calls[0]?.[1];
    expect(submitted?.get("name")).toBe("Billing");
    expect(submitted?.get("slug")).toBe("billing");
    expect(submitted?.get("description")).toBe("Invoices and payment runs.");
  });

  it("reports a taken slug against the slug field and keeps what was typed", async () => {
    const user = userEvent.setup();
    render(
      <CreateApplicationDialog
        action={makeAction({
          status: "error",
          message: "Choose a different slug.",
          fieldErrors: {
            slug: ["Another application already uses this slug."],
          },
        })}
      />,
    );

    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText("Name"), "Billing");
    await user.click(
      within(dialog).getByRole("button", { name: "Create application" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Another application already uses this slug.",
    );
    expect(within(dialog).getByLabelText("Slug")).toHaveAttribute(
      "aria-describedby",
      "app-slug-hint app-slug-error",
    );
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Billing");
  });

  it("says the slug cannot be changed later", async () => {
    const user = userEvent.setup();
    render(<CreateApplicationDialog action={makeAction({ status: "idle" })} />);

    const dialog = await openDialog(user);

    expect(within(dialog).getByText(/cannot be changed later/)).toBeVisible();
  });

  it("caps each field at the length the action accepts", async () => {
    const user = userEvent.setup();
    render(<CreateApplicationDialog action={makeAction({ status: "idle" })} />);

    const dialog = await openDialog(user);

    expect(within(dialog).getByLabelText("Name")).toHaveAttribute(
      "maxlength",
      "64",
    );
    expect(within(dialog).getByLabelText("Slug")).toHaveAttribute(
      "maxlength",
      "64",
    );
    expect(within(dialog).getByLabelText(/description/i)).toHaveAttribute(
      "maxlength",
      "280",
    );
  });
});
