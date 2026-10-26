import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { IngestKeyActionResult } from "@/lib/apps/actions";

import { CreateIngestKeyDialog } from "./create-ingest-key-dialog";
import type { IngestKeyAction } from "./ingest-key-action";

/**
 * The create dialog, driven through the action it is GIVEN.
 *
 * The real action is a server function that reaches the database. Here it is
 * a double passed as a prop — which is also the production shape, because
 * `IngestKeysSection` (a server component) imports the action and hands it
 * down. Nothing is mocked at module level: the dialog has no module-level
 * dependency on the action, and that absence is the property under test as
 * much as the behaviour is.
 */

const CREATED: IngestKeyActionResult = {
  status: "created",
  keyName: "Checkout — production",
  keyType: "SECRET",
  plaintext: "slg_sec_test_plaintext",
};

function makeAction(result: IngestKeyActionResult) {
  return vi.fn<IngestKeyAction>().mockResolvedValue(result);
}

function renderDialog(action: IngestKeyAction) {
  return render(
    <CreateIngestKeyDialog
      action={action}
      applicationId="app-1"
      applicationName="Checkout"
    />,
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Create key" }));

  return screen.getByRole("dialog");
}

async function submitServerKey(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
) {
  await user.type(
    within(dialog).getByLabelText("Name", { exact: true }),
    "Checkout — production",
  );
  await user.click(within(dialog).getByRole("radio", { name: /server key/i }));
  await user.click(within(dialog).getByRole("button", { name: "Create key" }));
}

describe("CreateIngestKeyDialog", () => {
  it("submits the form through the action it was given", async () => {
    const user = userEvent.setup();
    const action = makeAction(CREATED);
    renderDialog(action);

    const dialog = await openDialog(user);
    await submitServerKey(user, dialog);

    expect(
      await within(dialog).findByRole("heading", { name: "Key created" }),
    ).toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);

    const submitted = action.mock.calls[0]?.[1];
    expect(submitted?.get("applicationId")).toBe("app-1");
    expect(submitted?.get("name")).toBe("Checkout — production");
    expect(submitted?.get("type")).toBe("SECRET");
  });

  it("shows a new key once, and warns that a server key cannot be shown again", async () => {
    const user = userEvent.setup();
    renderDialog(makeAction(CREATED));

    const dialog = await openDialog(user);
    await submitServerKey(user, dialog);

    expect(
      await within(dialog).findByText("slg_sec_test_plaintext"),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /cannot be shown again/,
    );
  });

  it("reports the action's field errors against the field", async () => {
    const user = userEvent.setup();
    renderDialog(
      makeAction({
        status: "error",
        message: "Check the details and try again.",
        fieldErrors: { name: ["Give the key a name."] },
      }),
    );

    const dialog = await openDialog(user);
    await submitServerKey(user, dialog);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Give the key a name.",
    );
    expect(
      within(dialog).getByLabelText("Name", { exact: true }),
    ).toHaveAttribute("aria-describedby", "key-name-error");
  });

  it("caps the origin list at the length the action accepts", async () => {
    const user = userEvent.setup();
    renderDialog(makeAction(CREATED));

    const dialog = await openDialog(user);

    // The action's schema refuses a longer list; a textarea that let one be
    // typed would only ever produce a validation error after the fact.
    expect(within(dialog).getByLabelText("Allowed origins")).toHaveAttribute(
      "maxlength",
      "2000",
    );
  });
});
