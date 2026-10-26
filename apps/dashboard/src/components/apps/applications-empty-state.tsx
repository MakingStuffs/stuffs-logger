import { Boxes } from "lucide-react";

import { EmptyState } from "../ui-states/empty-state";

/**
 * `/apps` before any application exists.
 *
 * The next step differs by role, so the copy does too: an administrator is
 * pointed at the "New application" control in the page header, and a member —
 * who has no such control — is told who can create one.
 */
export function ApplicationsEmptyState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <EmptyState
      icon={Boxes}
      title="No applications yet"
      description={
        isAdmin
          ? "Create one with New application above. Each application gets a slug for its URLs and log filters, then the ingest keys its code sends logs with."
          : "An administrator needs to create an application before anything can send logs. Ask one to set it up, and it will appear here."
      }
    />
  );
}
