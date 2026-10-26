import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  ApiTokenAction,
  ApiTokenActionResult,
} from "@/lib/tokens/action-result";

import { CreateApiTokenDialog } from "./create-api-token-dialog";

/**
 * The mint dialog, driven through the action it is GIVEN — it never imports
 * the `"use server"` module, so the test can hand it any result.
 */

const RAW_TOKEN = "slg_api_Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5";

function makeAction(result: ApiTokenActionResult) {
  return vi.fn<ApiTokenAction>().mockResolvedValue(result);
}

async function openAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole("button", { name: "Create token" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("Name"), name);
  await user.click(
    within(dialog).getByRole("button", { name: "Create token" }),
  );

  return dialog;
}

describe("CreateApiTokenDialog", () => {
  it("submits the name and shows the raw token once, with the CRON_SECRET instruction", async () => {
    const user = userEvent.setup();
    const action = makeAction({
      status: "created",
      tokenName: "Retention cron",
      token: RAW_TOKEN,
    });
    render(<CreateApiTokenDialog action={action} />);

    const dialog = await openAndSubmit(user, "Retention cron");

    expect(
      await within(dialog).findByRole("heading", { name: "Token created" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(RAW_TOKEN)).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Set this as CRON_SECRET for the retention job. It cannot be shown again.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Copy the API token" }),
    ).toBeInTheDocument();
    expect(action.mock.calls[0]?.[1].get("name")).toBe("Retention cron");
  });

  it("discards the token when the dialog is closed", async () => {
    const user = userEvent.setup();
    render(
      <CreateApiTokenDialog
        action={makeAction({
          status: "created",
          tokenName: "Retention cron",
          token: RAW_TOKEN,
        })}
      />,
    );

    const dialog = await openAndSubmit(user, "Retention cron");
    await within(dialog).findByText(RAW_TOKEN);
    await user.click(within(dialog).getByRole("button", { name: "Done" }));

    expect(screen.queryByText(RAW_TOKEN)).not.toBeInTheDocument();

    // Reopening starts a fresh form, not the previous result.
    await user.click(screen.getByRole("button", { name: "Create token" }));
    expect(
      screen.getByRole("heading", { name: "Create an API token" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(RAW_TOKEN)).not.toBeInTheDocument();
  });

  it("shows a field error from the action against the name", async () => {
    const user = userEvent.setup();
    render(
      <CreateApiTokenDialog
        action={makeAction({
          status: "error",
          message: "Check the details and try again.",
          fieldErrors: { name: ["Too long."] },
        })}
      />,
    );

    const dialog = await openAndSubmit(user, "x");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Too long.",
    );
  });

  it("shows a refusal message that is not tied to a field", async () => {
    const user = userEvent.setup();
    render(
      <CreateApiTokenDialog
        action={makeAction({
          status: "error",
          message: "Only an administrator can do this.",
        })}
      />,
    );

    const dialog = await openAndSubmit(user, "Retention cron");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Only an administrator can do this.",
    );
  });

  it("caps the name field at 64 characters", async () => {
    const user = userEvent.setup();
    render(<CreateApiTokenDialog action={makeAction({ status: "idle" })} />);

    await user.click(screen.getByRole("button", { name: "Create token" }));

    expect(screen.getByLabelText("Name")).toHaveAttribute("maxLength", "64");
  });
});
