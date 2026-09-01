import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("renders a real button by default", () => {
    render(<Button>Apply filters</Button>);

    expect(
      screen.getByRole("button", { name: "Apply filters" }),
    ).toBeInTheDocument();
  });

  it("keeps navigation a real link when asked to render its child", () => {
    // An absolute URL keeps this about `asChild`: an in-app path would be a
    // test of `next/link` and its router, which this component does not touch.
    render(
      <Button asChild>
        <a href="https://logger.example.test/logs">Open log explorer</a>
      </Button>,
    );

    expect(
      screen.getByRole("link", { name: "Open log explorer" }),
    ).toHaveAttribute("href", "https://logger.example.test/logs");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("passes its disabled state through to the element", () => {
    render(<Button disabled>Revoke key</Button>);

    expect(screen.getByRole("button", { name: "Revoke key" })).toBeDisabled();
  });
});
