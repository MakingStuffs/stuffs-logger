import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { LogEventListItem } from "@/lib/logs/dto";

import { LogTable } from "./log-table";

function makeEvent(
  overrides: Partial<LogEventListItem> = {},
): LogEventListItem {
  return {
    id: "event-1",
    applicationId: "app-1",
    applicationSlug: "checkout",
    applicationName: "Checkout",
    timestamp: "2026-01-15T09:31:04.000Z",
    receivedAt: "2026-01-15T09:31:05.000Z",
    level: "error",
    message: "Payment provider timed out",
    logger: "manual",
    environment: "production",
    release: "1.4.2",
    source: "browser",
    sessionId: "session-1",
    url: "https://shop.example.test/checkout",
    deviceType: "mobile",
    os: "iOS 18",
    browser: "Safari",
    errorName: "TimeoutError",
    hasContext: true,
    ...overrides,
  };
}

describe("LogTable", () => {
  it("renders one row per event", () => {
    render(
      <LogTable
        events={[
          makeEvent({ id: "event-1", message: "First" }),
          makeEvent({ id: "event-2", message: "Second" }),
        ]}
      />,
    );

    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("shows the time in UTC, whatever the browser's timezone", () => {
    render(<LogTable events={[makeEvent()]} />);

    expect(screen.getByText("15 Jan 09:31:04")).toBeInTheDocument();
  });

  it("labels the severity in words as well as colour", () => {
    render(<LogTable events={[makeEvent({ level: "fatal" })]} />);

    expect(screen.getByText("Fatal")).toBeInTheDocument();
  });

  it("starts with every row collapsed", () => {
    render(<LogTable events={[makeEvent()]} />);

    expect(
      screen.getByRole("button", { name: /show details for/i }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("reveals the event's detail when the row is expanded", async () => {
    const user = userEvent.setup();
    render(<LogTable events={[makeEvent()]} />);

    await user.click(screen.getByRole("button", { name: /show details for/i }));

    expect(
      screen.getByRole("button", { name: /hide details for/i }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("TimeoutError")).toBeInTheDocument();
    expect(screen.getByText("Safari")).toBeInTheDocument();
  });

  it("collapses the row again when toggled twice", async () => {
    const user = userEvent.setup();
    render(<LogTable events={[makeEvent()]} />);

    await user.click(screen.getByRole("button", { name: /show details for/i }));
    await user.click(screen.getByRole("button", { name: /hide details for/i }));

    expect(screen.queryByText("TimeoutError")).not.toBeInTheDocument();
  });

  it("keeps only one row open at a time", async () => {
    const user = userEvent.setup();
    render(
      <LogTable
        events={[
          makeEvent({ id: "event-1", errorName: "FirstError" }),
          makeEvent({ id: "event-2", errorName: "SecondError" }),
        ]}
      />,
    );

    const toggles = screen.getAllByRole("button", {
      name: /show details for/i,
    });
    await user.click(toggles[0] as HTMLElement);
    await user.click(
      screen.getAllByRole("button", {
        name: /show details for/i,
      })[0] as HTMLElement,
    );

    expect(screen.queryByText("FirstError")).not.toBeInTheDocument();
    expect(screen.getByText("SecondError")).toBeInTheDocument();
  });

  it("renders an HTML-shaped message as text, never as markup", () => {
    const payload = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <LogTable events={[makeEvent({ message: payload })]} />,
    );

    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders a script-shaped message as text, never as markup", () => {
    const payload = "<script>alert(document.cookie)</script>";
    const { container } = render(
      <LogTable events={[makeEvent({ message: payload })]} />,
    );

    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  it("links a page URL that uses a safe scheme", async () => {
    const user = userEvent.setup();
    render(<LogTable events={[makeEvent()]} />);

    await user.click(screen.getByRole("button", { name: /show details for/i }));

    expect(
      screen.getByRole("link", { name: /shop\.example\.test/ }),
    ).toHaveAttribute("href", "https://shop.example.test/checkout");
  });

  it("refuses to link a javascript: page URL, showing it as text instead", async () => {
    const user = userEvent.setup();
    const payload = "javascript:fetch('/api/steal')";
    render(<LogTable events={[makeEvent({ url: payload })]} />);

    await user.click(screen.getByRole("button", { name: /show details for/i }));

    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /javascript/i }),
    ).not.toBeInTheDocument();
  });

  it("refuses to link a data: page URL", async () => {
    const user = userEvent.setup();
    const payload = "data:text/html,<script>alert(1)</script>";
    render(<LogTable events={[makeEvent({ url: payload })]} />);

    await user.click(screen.getByRole("button", { name: /show details for/i }));

    expect(
      screen.queryByRole("link", { name: /data:/i }),
    ).not.toBeInTheDocument();
  });

  it("gives the table a caption naming the ordering and the timezone", () => {
    render(<LogTable events={[makeEvent()]} />);

    const table = screen.getByRole("table");
    expect(
      within(table).getByText(/newest first.*times are utc/i),
    ).toBeInTheDocument();
  });

  it("labels every column", () => {
    render(<LogTable events={[makeEvent()]} />);

    expect(
      screen.getByRole("columnheader", { name: "Time (UTC)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Message" }),
    ).toBeInTheDocument();
  });
});
