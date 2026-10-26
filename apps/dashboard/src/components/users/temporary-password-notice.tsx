import { TriangleAlert } from "lucide-react";

import { CopyButton } from "../apps/copy-button";

/**
 * A temporary password, shown the one time it exists in plaintext.
 *
 * The same "shown once" pattern as a new secret ingest key: the value lives
 * only in the action's result, held in the dialog's state, and is gone when
 * the dialog closes. Only its hash is stored, so there is nothing to show
 * again — losing it means issuing another.
 */
export function TemporaryPasswordNotice({
  email,
  password,
}: {
  /** Whose password this is. */
  email: string;
  /** The plaintext, exactly as generated. */
  password: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p
        role="alert"
        className="border-destructive/40 bg-destructive/5 flex items-start gap-2 rounded-sm border p-3 text-sm"
      >
        <TriangleAlert
          className="text-destructive mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <span>
          Copy this password now — it cannot be shown again. Send it to {email}{" "}
          through a private channel (not a shared chat or a ticket), and ask
          them to change it on their Account page after signing in.
        </span>
      </p>

      <div className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">
          Temporary password
        </span>
        <code className="bg-muted rounded-sm p-3 font-mono text-sm break-all">
          {password}
        </code>
        <CopyButton value={password} label="the temporary password" />
      </div>
    </div>
  );
}
