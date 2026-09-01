import { getSessionOrRedirect } from "@journey-further/salient-auth/server";

import { AppShell } from "@/components/app-shell";
import { APP_SLUG } from "@/constants/environment";

/**
 * PLACEHOLDER. The overview UI is owned by the frontend work that follows this
 * change; what matters here is the gate and the shell around it.
 *
 * Gated per PAGE with `getSessionOrRedirect`, not in the layout: a layout check
 * does not re-run on client-side navigation, so it is a UX convenience rather
 * than a boundary. The call throws to redirect, so it is never wrapped in
 * try/catch.
 */
export default async function HomePage() {
  const session = await getSessionOrRedirect(APP_SLUG, { returnPath: "/" });

  return (
    <AppShell user={session.user}>
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">JF Logger</h1>
        <p className="text-muted-foreground">
          Log ingest is live. The dashboard views are not built yet.
        </p>
      </div>
    </AppShell>
  );
}
