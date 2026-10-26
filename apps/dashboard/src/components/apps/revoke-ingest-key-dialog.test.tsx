import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { IngestKeyActionResult } from "@/lib/apps/actions";

import type { IngestKeyAction } from "./ingest-key-action";
import { RevokeIngestKeyDialog } from "./revoke-ingest-key-dialog";

/**
 * The revoke dialog, driven through the action it is GIVEN — see the create
 * dialog's suite for why the action arrives as a prop rather than an import.
 */

const KEY_NAME = "Checkout — production";

function makeAction(result: IngestKeyActionResult) {
  return vi.fn<IngestKeyAction>().mockResolvedValue(result);
}

function renderDialog(action: IngestKeyAction) {
  return render(
    <RevokeIngestKeyDialog action={action} keyId="key-1" keyName={KEY_NAME} />,
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: `Revoke ${KEY_NAME}` }));

  return screen.getByRole("dialog");
}

async function confirmWith(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  typed: string,
) {
  await user.type(
    within(dialog).getByLabelText(/type the key.s name to confirm/i),
    typed,
  );
  await user.click(within(dialog).getByRole("button", { name: "Revoke key" }));
}

describe("RevokeIngestKeyDialog", () => {
  it("submits the retyped name through the action it was given, and closes on success", async () => {
    const user = userEvent.setup();
    const action = makeAction({ status: "revoked", keyName: KEY_NAME });
    renderDialog(action);

    const dialog = await openDialog(user);
    await confirmWith(user, dialog, KEY_NAME);

    // The page revalidates itself on success; the dialog's only job is to go.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    const submitted = action.mock.calls[0]?.[1];
    expect(submitted?.get("keyId")).toBe("key-1");
    expect(submitted?.get("confirmName")).toBe(KEY_NAME);
  });

  it("stays open and names the mismatch when the action refuses", async () => {
    const user = userEvent.setup();
    renderDialog(
      makeAction({
        status: "error",
        message: "The name you typed does not match this key.",
        fieldErrors: { confirmName: ["Type the key's name exactly."] },
      }),
    );

    const dialog = await openDialog(user);
    await confirmWith(user, dialog, `${KEY_NAME} but wrong`);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Type the key's name exactly.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
