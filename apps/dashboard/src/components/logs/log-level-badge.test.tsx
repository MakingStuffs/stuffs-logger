import { LOG_LEVELS } from "@stuffs-logger/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LEVEL_BADGE_VARIANT, LEVEL_LABELS } from "./filter-vocabulary";
import { LogLevelBadge } from "./log-level-badge";

describe("LogLevelBadge", () => {
  it.each(LOG_LEVELS)(
    "spells out %s rather than signalling it by colour",
    (level) => {
      render(<LogLevelBadge level={level} />);

      expect(screen.getByText(LEVEL_LABELS[level])).toBeInTheDocument();
    },
  );

  it("gives the two levels nobody triages by the quietest treatment", () => {
    expect(LEVEL_BADGE_VARIANT.trace).toBe("outline");
    expect(LEVEL_BADGE_VARIANT.debug).toBe("outline");
  });

  it("reserves the loudest treatment for fatal alone", () => {
    const loudest = Object.values(LEVEL_BADGE_VARIANT).filter(
      (variant) => variant === "critical",
    );

    expect(loudest).toHaveLength(1);
    expect(LEVEL_BADGE_VARIANT.fatal).toBe("critical");
  });
});
