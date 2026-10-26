import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ApplicationUsageToday } from "@/lib/apps/dto";

import { ApplicationUsage } from "./application-usage";

function makeUsage(
  overrides: Partial<ApplicationUsageToday> = {},
): ApplicationUsageToday {
  return {
    day: "2026-10-22",
    eventCount: 50_000,
    byteCount: 52_428_800,
    eventQuota: 250_000,
    byteQuota: 1024 * 1024 * 1024,
    ...overrides,
  };
}

describe("ApplicationUsage", () => {
  it("labels a bar per metric with how much of the ceiling is used", () => {
    render(<ApplicationUsage usage={makeUsage()} />);

    expect(screen.getByRole("progressbar", { name: "Events" })).toHaveAttribute(
      "aria-valuenow",
      "20",
    );
    expect(
      screen.getByRole("progressbar", { name: "Data received" }),
    ).toHaveAttribute("aria-valuenow", "4");
  });

  it("states the figures in words as well as in the bar", () => {
    render(<ApplicationUsage usage={makeUsage()} />);

    expect(screen.getByText("50,000 of 250,000 (20%)")).toBeInTheDocument();
    expect(screen.getByText("50 MiB of 1 GiB (4%)")).toBeInTheDocument();
  });

  it("says which UTC day the counters cover", () => {
    render(<ApplicationUsage usage={makeUsage()} />);

    expect(screen.getByText(/midnight UTC on 2026-10-22/)).toBeInTheDocument();
  });

  it("says plainly when a ceiling has been reached", () => {
    render(<ApplicationUsage usage={makeUsage({ eventCount: 260_000 })} />);

    expect(screen.getByRole("progressbar", { name: "Events" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.getByText(/Ceiling reached/)).toHaveTextContent(
      "New events are being refused",
    );
  });

  it("shows an untouched day as empty bars", () => {
    render(
      <ApplicationUsage usage={makeUsage({ eventCount: 0, byteCount: 0 })} />,
    );

    expect(screen.getByText("0 of 250,000 (0%)")).toBeInTheDocument();
    expect(screen.queryByText(/Ceiling reached/)).not.toBeInTheDocument();
  });
});
