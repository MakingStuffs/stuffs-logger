import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { makeLogEventListItem as makeEvent } from "./log-event-fixtures";
import { LogTable } from "./log-table";

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

  it("shows the event's context as JSON text when the row is expanded", async () => {
    const user = userEvent.setup();
    render(<LogTable events={[makeEvent()]} />);

    await user.click(screen.getByRole("button", { name: /show details for/i }));

    expect(
      screen.getByRole("group", { name: "Event context, as JSON" }),
    ).toHaveTextContent('"orderId": "abc-123"');
  });

  it("shows the stack trace when the row is expanded", async () => {
    const user = userEvent.setup();
    render(<LogTable events={[makeEvent()]} />);

    await user.click(screen.getByRole("button", { name: /show details for/i }));

    expect(
      screen.getByRole("group", { name: "Stack trace" }),
    ).toHaveTextContent("at pay (checkout.js:14:9)");
  });

  it("renders an HTML-shaped context value as text, never as markup", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LogTable
        events={[
          makeEvent({
            context: { note: '<img src=x onerror="alert(1)">' },
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /show details for/i }));

    expect(
      screen.getByRole("group", { name: "Event context, as JSON" }),
    ).toHaveTextContent("onerror");
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders an HTML-shaped stack trace as text, never as markup", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LogTable
        events={[
          makeEvent({
            errorStack:
              'Error: boom\n    at <iframe src="javascript:alert(1)">',
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /show details for/i }));

    expect(
      screen.getByRole("group", { name: "Stack trace" }),
    ).toHaveTextContent("javascript:alert(1)");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("points at the full event when the context was reduced for the stream", async () => {
    const user = userEvent.setup();
    render(<LogTable events={[makeEvent({ contextTruncated: true })]} />);

    await user.click(screen.getByRole("button", { name: /show details for/i }));

    expect(
      screen.getByText(/left out to keep the stream light/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View the whole context" }),
    ).toHaveAttribute("href", "/logs/event-1");
  });

  it("says so when the context is too large to carry in the stream at all", async () => {
    const user = userEvent.setup();
    render(
      <LogTable
        events={[makeEvent({ context: null, contextTruncated: true })]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /show details for/i }));

    expect(
      screen.getByText(/too large to show in the stream/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Event context, as JSON" }),
    ).not.toBeInTheDocument();
  });

  it("points at the full event when the stack was cut short", async () => {
    const user = userEvent.setup();
    render(<LogTable events={[makeEvent({ errorStackTruncated: true })]} />);

    await user.click(screen.getByRole("button", { name: /show details for/i }));

    expect(
      screen.getByText(/cut short to keep the stream light/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View the whole trace" }),
    ).toHaveAttribute("href", "/logs/event-1");
  });

  it("shows no context block for an event that was logged without any", async () => {
    const user = userEvent.setup();
    render(
      <LogTable events={[makeEvent({ hasContext: false, context: null })]} />,
    );

    await user.click(screen.getByRole("button", { name: /show details for/i }));

    expect(
      screen.queryByRole("group", { name: "Event context, as JSON" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View full event" }),
    ).toBeInTheDocument();
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
