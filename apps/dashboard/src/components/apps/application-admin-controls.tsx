import {
  createApplicationAction,
  deleteApplicationAction,
  updateApplicationAction,
} from "@/lib/apps/application-actions";
import type { ApplicationSummary } from "@/lib/logs/dto";

import { CreateApplicationDialog } from "./create-application-dialog";
import { DeleteApplicationDialog } from "./delete-application-dialog";
import { EditApplicationDialog } from "./edit-application-dialog";

/**
 * The admin-only application controls, wired to their Server Actions.
 *
 * THE ACTIONS ARE IMPORTED HERE, in server components, and handed to the
 * client dialogs as props — the same single import site `IngestKeysSection`
 * keeps for the key actions, and for the same reason: imported from the
 * `"use client"` dialogs, the action module would be compiled into a second,
 * client-side layer with its own copy of the database client and the auth
 * instance.
 *
 * Pages render these only for administrators. That is presentation, not the
 * control: every action re-checks the caller's role itself.
 */

/** The "New application" button and its dialog, for `/apps`. */
export function CreateApplicationControl() {
  return <CreateApplicationDialog action={createApplicationAction} />;
}

/** The "Edit details" button and its dialog, for an application's page. */
export function EditApplicationControl({
  application,
}: {
  application: ApplicationSummary;
}) {
  return (
    <EditApplicationDialog
      action={updateApplicationAction}
      application={application}
    />
  );
}

/**
 * The application page's "Danger zone": deletion, set apart from everything
 * else on the page so it is never reached for by accident.
 */
export function ApplicationDangerZone({
  application,
}: {
  application: ApplicationSummary;
}) {
  return (
    <section
      aria-labelledby="danger-zone-heading"
      className="border-destructive/40 flex flex-col gap-4 rounded-lg border p-5"
    >
      <div>
        <h2
          id="danger-zone-heading"
          className="text-destructive text-lg font-semibold"
        >
          Danger zone
        </h2>
        <p className="text-muted-foreground text-sm">
          Deleting {application.name} removes its ingest keys and every log line
          it has sent, permanently. Revoke a key instead if you only need to
          stop one deployment logging.
        </p>
      </div>
      <div>
        <DeleteApplicationDialog
          action={deleteApplicationAction}
          application={application}
        />
      </div>
    </section>
  );
}
