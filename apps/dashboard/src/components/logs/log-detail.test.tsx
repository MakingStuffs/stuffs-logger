import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LogEventDetail } from "@/lib/logs/dto";

import { LogDetail } from "./log-detail";

function makeEvent(overrides: Partial<LogEventDetail> = {}): LogEventDetail {
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
    userAgent: "Mozilla/5.0",
    context: { orderId: "abc-123" },
    errorMessage: "Timed out after 30s",
    errorStack: "TimeoutError: Timed out\n    at pay (checkout.js:14:9)",
    ...overrides,
  };
}

describe("LogDetail", () => {
  it("shows the message", () => {
    render(<LogDetail event={makeEvent()} />);

    expect(screen.getByText("Payment provider timed out")).toBeInTheDocument();
  });

  it("renders the context as JSON text", () => {
    render(<LogDetail event={makeEvent()} />);

    const context = screen.getByRole("group", {
      name: "Event context, as JSON",
    });
    expect(context).toHaveTextContent('"orderId": "abc-123"');
  });

  it("makes the context block reachable by keyboard, since it scrolls", () => {
    render(<LogDetail event={makeEvent()} />);

    expect(
      screen.getByRole("group", { name: "Event context, as JSON" }),
    ).toHaveAttribute("tabindex", "0");
  });

  it("explains an event that carries no context", () => {
    render(
      <LogDetail event={makeEvent({ hasContext: false, context: null })} />,
    );

    expect(
      screen.getByText(/logged without any additional context/i),
    ).toBeInTheDocument();
  });

  it("renders a stack trace as text, never as markup", () => {
    const payload = 'Error: boom\n    at <img src=x onerror="alert(1)">';
    const { container } = render(
      <LogDetail event={makeEvent({ errorStack: payload })} />,
    );

    expect(
      screen.getByRole("group", { name: "Stack trace" }),
    ).toHaveTextContent("onerror");
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders an HTML-shaped context value as text, never as markup", () => {
    const { container } = render(
      <LogDetail
        event={makeEvent({
          context: { note: "<iframe src='javascript:alert(1)'></iframe>" },
        })}
      />,
    );

    expect(container.querySelector("iframe")).toBeNull();
  });

  it("renders an HTML-shaped user agent as text, never as markup", () => {
    const payload = '<img src=x onerror="alert(1)"> Mozilla/5.0';
    const { container } = render(
      <LogDetail event={makeEvent({ userAgent: payload })} />,
    );

    expect(
      screen.getByRole("group", { name: "Reported user agent" }),
    ).toHaveTextContent("onerror");
    expect(container.querySelector("img")).toBeNull();
  });

  it("omits the error card entirely when the event is not an error", () => {
    render(
      <LogDetail
        event={makeEvent({
          level: "info",
          errorName: null,
          errorStack: null,
          errorMessage: null,
        })}
      />,
    );

    expect(screen.queryByText("Stack trace")).not.toBeInTheDocument();
  });

  it("links back to the application's own log stream", () => {
    render(<LogDetail event={makeEvent()} />);

    expect(screen.getByRole("link", { name: "Checkout" })).toHaveAttribute(
      "href",
      "/logs?applicationSlug=checkout",
    );
  });

  it("refuses to link a javascript: page URL", () => {
    const payload = "javascript:alert(document.cookie)";
    render(<LogDetail event={makeEvent({ url: payload })} />);

    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /javascript/i }),
    ).not.toBeInTheDocument();
  });

  it("opens an external page URL without leaking the referrer or the opener", () => {
    render(<LogDetail event={makeEvent()} />);

    const link = screen.getByRole("link", { name: /shop\.example\.test/ });
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });
});
