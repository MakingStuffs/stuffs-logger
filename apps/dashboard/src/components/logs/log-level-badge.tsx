import type { LogLevel } from "@stuffs-logger/core/taxonomy";

import { Badge } from "../ui/badge";

import { LEVEL_BADGE_VARIANT, LEVEL_LABELS } from "./filter-vocabulary";

/**
 * A severity, as a badge.
 *
 * The level is always spelled out rather than signalled by colour alone, so it
 * survives a colour-blind reader, a greyscale print and a theme change.
 *
 * Squared off and set in the monospace face, unlike every other badge in the
 * app: in a column of two hundred rows the severity is a code to be scanned
 * rather than a label to be read, and a fixed-width glyph in a fixed-width box
 * makes the shape of the column itself carry information. The width is fixed
 * for the same reason — the badges align whatever the word inside them.
 */
export function LogLevelBadge({ level }: { level: LogLevel }) {
  return (
    <Badge
      variant={LEVEL_BADGE_VARIANT[level]}
      className="w-16 justify-center rounded-sm font-mono text-xs tracking-wide uppercase"
    >
      {LEVEL_LABELS[level]}
    </Badge>
  );
}
