import { UserRound } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountSections } from "@/components/account/account-sections";
import { AccountSkeleton } from "@/components/account/account-skeleton";
import { AppHeader } from "@/components/shell/app-header";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";
import {
  AccessRefused,
  resolveAccess,
} from "@/components/ui-states/access-refused";
import { getSessionOrRedirect } from "@/lib/auth/session";
import type { AppSession } from "@/lib/auth/types";
import { getOwnAccount } from "@/lib/users/queries";

export const metadata: Metadata = {
  title: "Account",
};

/**
 * Your own account: name, address, role, password and sessions. Every
 * signed-in user.
 *
 * Gated per page like every other, and the read gates again: a deactivated
 * account gets the designed refusal rather than a password form it could no
 * longer use.
 */
export default async function AccountPage() {
  const session = await getSessionOrRedirect({ returnPath: "/account" });

  return (
    <>
      <AppHeader
        header="Account"
        copy="Your profile, your password and where you are signed in."
        icon={UserRound}
      />
      <PageContentWrapper className="px-6 py-8">
        <Suspense fallback={<AccountSkeleton />}>
          <AccountContent session={session} />
        </Suspense>
      </PageContentWrapper>
    </>
  );
}

async function AccountContent({ session }: { session: AppSession }) {
  const outcome = await resolveAccess(() => getOwnAccount(session));
  if (!outcome.allowed) return <AccessRefused code={outcome.code} />;

  return <AccountSections account={outcome.data} />;
}
