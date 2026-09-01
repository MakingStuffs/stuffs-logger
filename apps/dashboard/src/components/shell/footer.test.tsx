import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Footer } from "./footer";

describe("Footer", () => {
  it("says which build is on screen", () => {
    render(<Footer appName="Stuffs Logger" appVersion="0.1.0" />);

    expect(screen.getByText(/Stuffs Logger v0\.1\.0/)).toBeInTheDocument();
  });

  it("is a footer landmark, so it can be skipped", () => {
    render(<Footer appName="Stuffs Logger" appVersion="0.1.0" />);

    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });
});
