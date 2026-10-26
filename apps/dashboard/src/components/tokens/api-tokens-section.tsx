import { KeyRound } from "lucide-react";

import {
  createApiTokenAction,
  revokeApiTokenAction,
} from "@/lib/tokens/actions";
import type { ApiTokenSummary } from "@/lib/tokens/dto";

import { formatUtcTimestampLong } from "../logs/format";
import { Badge } from "../ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { EmptyState } from "../ui-states/empty-state";

import { CreateApiTokenDialog } from "./create-api-token-dialog";
import { RetentionJobNote } from "./retention-job-note";
import { RevokeApiTokenDialog } from "./revoke-api-token-dialog";

/**
 * Every API token, with the controls to mint and revoke them.
 *
 * Rendered only after the admin gate has passed, so it has no refusal state
 * of its own. THE ACTIONS ARE IMPORTED HERE, in a server component, and handed
 * to the client dialogs as props, so the `"use server"` module is never on the
 * client module graph.
 *
 * No token value appears anywhere in this table: the DTO has no field that
 * could carry one.
 */
export function ApiTokensSection({ tokens }: { tokens: ApiTokenSummary[] }) {
  return (
    <section
      aria-labelledby="api-tokens-heading"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="api-tokens-heading" className="text-lg font-semibold">
            API tokens
          </h2>
          <p className="text-muted-foreground text-sm">
            Credentials for machine callers. Only a hash of each is stored.
          </p>
        </div>
        <CreateApiTokenDialog action={createApiTokenAction} />
      </div>

      <RetentionJobNote />

      {tokens.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API tokens yet"
          description="The retention job cannot run until it has a token. Create one, then set it as CRON_SECRET wherever the job is scheduled."
        />
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableCaption className="sr-only">
              API tokens. All times are UTC.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Name</TableHead>
                <TableHead scope="col">Created</TableHead>
                <TableHead scope="col">Last used</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => (
                <ApiTokenRow key={token.id} token={token} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function ApiTokenRow({ token }: { token: ApiTokenSummary }) {
  const isRevoked = token.revokedAt !== null;

  return (
    <TableRow>
      <TableCell className="font-medium">{token.name}</TableCell>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
        {formatUtcTimestampLong(token.createdAt)}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
        {token.lastUsedAt === null
          ? "Never"
          : formatUtcTimestampLong(token.lastUsedAt)}
      </TableCell>
      <TableCell>
        {isRevoked ? (
          <Badge variant="destructive">Revoked</Badge>
        ) : (
          <Badge variant="secondary">Active</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        {isRevoked ? null : (
          <RevokeApiTokenDialog
            action={revokeApiTokenAction}
            tokenId={token.id}
            tokenName={token.name}
          />
        )}
      </TableCell>
    </TableRow>
  );
}
