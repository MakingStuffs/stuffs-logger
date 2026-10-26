import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AppHeader } from "@/components/shell/app-header";
import { ApiTokensSection } from "@/components/tokens/api-tokens-section";
import { ApiTokensSkeleton } from "@/components/tokens/api-tokens-skeleton";
import {
  AccessRefused,
  resolveAccess,
} from "@/components/ui-states/access-refused";
import { PageContentWrapper } from "@/components/ui/page-content-wrapper";
import { getSessionOrRedirect } from "@/lib/auth/session";
import type { AppSession } from "@/lib/auth/types";
import { API_TOKENS_PATH } from "@/lib/tokens/constants";
import { listApiTokens } from "@/lib/tokens/queries";

export const metadata: Metadata = {
  title: "API tokens",
};

/**
 * Machine credentials: minting, listing and revoking API tokens.
 *
 * ADMIN ONLY. The page gates on a session, and the listing itself asserts an
 * administrator; a member gets the designed refusal in the content's place,
 * never the table or the mint control. The header carries no actions so that
 * nothing a member could reach is rendered outside that gate.
 */
export default async function ApiTokensPage() {
  const session = await getSessionOrRedirect({ returnPath: API_TOKENS_PATH });

  return (
    <>
      <AppHeader
        header="API tokens"
        copy="Credentials for scheduled jobs that call Stuffs Logger without a person signed in."
        icon={KeyRound}
      />

      <PageContentWrapper className="px-6 py-8">
        <Suspense fallback={<ApiTokensSkeleton />}>
          <ApiTokensContent session={session} />
        </Suspense>
      </PageContentWrapper>
    </>
  );
}

async function ApiTokensContent({ session }: { session: AppSession }) {
  const outcome = await resolveAccess(() => listApiTokens(session));
  if (!outcome.allowed) return <AccessRefused code={outcome.code} />;

  return <ApiTokensSection tokens={outcome.data} />;
}
