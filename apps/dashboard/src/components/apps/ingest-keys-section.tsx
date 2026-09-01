import { Badge } from "@journey-further/salient-ui/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@journey-further/salient-ui/ui/table";
import { KeyRound } from "lucide-react";

import type { ApplicationSummary, IngestKeySummary } from "@/lib/logs/dto";

import { EMPTY_VALUE, formatUtcTimestampLong } from "../logs/format";
import { EmptyState } from "../ui-states/empty-state";

import { CopyButton } from "./copy-button";
import { CreateIngestKeyDialog } from "./create-ingest-key-dialog";
import { RevokeIngestKeyDialog } from "./revoke-ingest-key-dialog";

/**
 * Ingest keys for one application.
 *
 * Note what is not here: a secret key's value. The data layer has no shape
 * that can carry one, and the plaintext exists only in the response of the
 * action that created it. The table shows a public key — which is designed to
 * be readable — and, for a secret key, only its label and status.
 *
 * Nor is there a refusal state: listing keys and reading the application are
 * gated on the same check, so a viewer who got as far as rendering this
 * section is entitled to its contents. The refusal is the whole PAGE's, and
 * lives there.
 */
export function IngestKeysSection({
  application,
  keys,
}: {
  application: ApplicationSummary;
  keys: IngestKeySummary[];
}) {
  return (
    <section
      aria-labelledby="ingest-keys-heading"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="ingest-keys-heading" className="text-lg font-semibold">
            Ingest keys
          </h2>
          <p className="text-muted-foreground text-sm">
            The credentials {application.name} uses to send logs.
          </p>
        </div>
        <CreateIngestKeyDialog
          applicationId={application.id}
          applicationName={application.name}
        />
      </div>

      {keys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No ingest keys yet"
          description={`${application.name} cannot send logs until it has a key. Create a browser key for a website, or a server key for a Node process.`}
        />
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableCaption className="sr-only">
              Ingest keys for {application.name}. All times are UTC.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Name</TableHead>
                <TableHead scope="col">Type</TableHead>
                <TableHead scope="col">Key</TableHead>
                <TableHead scope="col">Allowed origins</TableHead>
                <TableHead scope="col">Last used (UTC)</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <IngestKeyRow key={key.id} ingestKey={key} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function IngestKeyRow({ ingestKey }: { ingestKey: IngestKeySummary }) {
  const isRevoked = ingestKey.revokedAt !== null;

  return (
    <TableRow>
      <TableCell className="font-medium">{ingestKey.name}</TableCell>
      <TableCell>
        <Badge variant="outline">
          {ingestKey.type === "PUBLIC" ? "Browser" : "Server"}
        </Badge>
      </TableCell>
      <TableCell>
        {ingestKey.publicKey === null ? (
          <span className="text-muted-foreground text-xs">
            Shown once at creation
          </span>
        ) : (
          <div className="flex flex-col gap-1">
            <code className="font-mono text-xs break-all">
              {ingestKey.publicKey}
            </code>
            <CopyButton
              value={ingestKey.publicKey}
              label={`the key ${ingestKey.name}`}
            />
          </div>
        )}
      </TableCell>
      <TableCell>
        {ingestKey.allowedOrigins.length === 0 ? (
          <span className="text-muted-foreground text-xs">
            {ingestKey.type === "SECRET" ? "Not origin-bound" : EMPTY_VALUE}
          </span>
        ) : (
          <ul className="flex flex-col gap-0.5 text-xs">
            {ingestKey.allowedOrigins.map((origin) => (
              <li key={origin} className="font-mono break-all">
                {origin}
              </li>
            ))}
          </ul>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
        {ingestKey.lastUsedAt === null
          ? "Never"
          : formatUtcTimestampLong(ingestKey.lastUsedAt)}
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
          <RevokeIngestKeyDialog
            keyId={ingestKey.id}
            keyName={ingestKey.name}
          />
        )}
      </TableCell>
    </TableRow>
  );
}
