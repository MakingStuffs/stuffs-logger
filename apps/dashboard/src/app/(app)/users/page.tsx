import { Users } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AppHeader } from "@/components/shell/app-header";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";
import {
  AccessRefused,
  resolveAccess,
} from "@/components/ui-states/access-refused";
import { CreateUserDialog } from "@/components/users/create-user-dialog";
import { UsersTable } from "@/components/users/users-table";
import { UsersTableSkeleton } from "@/components/users/users-table-skeleton";
import { getSessionOrRedirect } from "@/lib/auth/session";
import { isAdminUser } from "@/lib/auth/roles";
import type { AppSession } from "@/lib/auth/types";
import { createUserAction } from "@/lib/users/actions";
import { listUsers } from "@/lib/users/queries";

export const metadata: Metadata = {
  title: "Users",
};

/**
 * Who can sign in, and the admin controls over each of them. ADMIN ONLY.
 *
 * The page gates itself (`getSessionOrRedirect`), and the read behind it
 * gates again (`listUsers` runs `assertAdminViewer`), so a member who
 * navigates here gets the designed `AccessRefused` state rather than the
 * table. The "Add user" control is offered to administrators only — as
 * presentation; the action behind it refuses anyone else on its own.
 */
export default async function UsersPage() {
  const session = await getSessionOrRedirect({ returnPath: "/users" });

  return (
    <>
      <AppHeader
        header="Users"
        copy="Everyone who can sign in, how they sign in, and what they may do."
        icon={Users}
      >
        {isAdminUser(session) ? (
          <CreateUserDialog action={createUserAction} />
        ) : undefined}
      </AppHeader>

      <PageContentWrapper className="px-6 py-8">
        <Suspense fallback={<UsersTableSkeleton />}>
          <UsersContent session={session} />
        </Suspense>
      </PageContentWrapper>
    </>
  );
}

async function UsersContent({ session }: { session: AppSession }) {
  const outcome = await resolveAccess(() => listUsers(session));
  if (!outcome.allowed) return <AccessRefused code={outcome.code} />;

  return <UsersTable users={outcome.data} viewerId={session.user.id} />;
}
