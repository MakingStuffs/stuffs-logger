/**
 * The only shape an API token leaves the data layer in.
 *
 * There is deliberately no field that could carry `tokenHash` or the raw
 * token: a digest of a live credential has no use in any UI, and the surest
 * way for it never to reach a response is for no DTO to have room for it.
 * Dates cross as ISO strings so the row can be handed to a client component.
 * Browser-safe: types only.
 */
export interface ApiTokenSummary {
  id: string;
  /** The operator's label. Never the token itself. */
  name: string;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601, or `null` when the token has never been accepted. */
  lastUsedAt: string | null;
  /** ISO-8601, or `null` while the token is live. */
  revokedAt: string | null;
}
