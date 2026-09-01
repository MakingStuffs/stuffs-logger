import type { LogLevel } from "@stuffs-logger/core";
import { Badge } from "@journey-further/salient-ui/ui/badge";

import { LEVEL_BADGE_VARIANT, LEVEL_LABELS } from "./filter-vocabulary";

/**
 * A severity, as a design-system badge.
 *
 * The level is always spelled out rather than signalled by colour alone, so it
 * survives a colour-blind reader, a greyscale print and a theme change.
 */
export function LogLevelBadge({ level }: { level: LogLevel }) {
  return (
    <Badge
      variant={LEVEL_BADGE_VARIANT[level]}
      className="w-16 justify-center tabular-nums"
    >
      {LEVEL_LABELS[level]}
    </Badge>
  );
}
