import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  ApiTokenAction,
  ApiTokenActionResult,
} from "@/lib/tokens/action-result";

import { RevokeApiTokenDialog } from "./revoke-api-token-dialog";

const TOKEN_NAME = "Retention cron";

function makeAction(result: ApiTokenActionResult) {
  return vi.fn<ApiTokenAction>().mockResolvedValue(result);
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: `Revoke ${TOKEN_NAME}` }),
  );

  return screen.getByRole("dialog");
}

async function confirmWith(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  typed: string,
) {
  await user.type(
    within(dialog).getByLabelText(/type the token.s name to confirm/i),
    typed,
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Revoke token" }),
  );
}

function renderDialog(action: ApiTokenAction) {
  return render(
    <RevokeApiTokenDialog
      action={action}
      tokenId="token-1"
      tokenName={TOKEN_NAME}
    />,
  );
}

describe("RevokeApiTokenDialog", () => {
  it("explains that the retention job answers 401 until CRON_SECRET is replaced", async () => {
    const user = userEvent.setup();
    renderDialog(makeAction({ status: "idle" }));

    const dialog = await openDialog(user);

    expect(dialog).toHaveTextContent(
      /answering 401 until CRON_SECRET is replaced/,
    );
  });

  it("submits the token id and retyped name, and closes on success", async () => {
    const user = userEvent.setup();
    const action = makeAction({ status: "revoked", tokenName: TOKEN_NAME });
    renderDialog(action);

    const dialog = await openDialog(user);
    await confirmWith(user, dialog, TOKEN_NAME);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const submitted = action.mock.calls[0]?.[1];
    expect(submitted?.get("tokenId")).toBe("token-1");
    expect(submitted?.get("confirmName")).toBe(TOKEN_NAME);
  });

  it("stays open and names the mismatch when the action refuses", async () => {
    const user = userEvent.setup();
    renderDialog(
      makeAction({
        status: "error",
        message: "The name you typed does not match this token.",
        fieldErrors: { confirmName: ["Type the token's name exactly."] },
      }),
    );

    const dialog = await openDialog(user);
    await confirmWith(user, dialog, `${TOKEN_NAME} but wrong`);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Type the token's name exactly.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
