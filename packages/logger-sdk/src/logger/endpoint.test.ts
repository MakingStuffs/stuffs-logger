import { afterEach, describe, expect, it, vi } from "vitest";

import { INGEST_PATH } from "../contract";
import { resolveEndpoint } from "./endpoint";

describe("resolveEndpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends the ingest path to an origin", () => {
    expect(resolveEndpoint("https://logs.example.com")).toBe(
      `https://logs.example.com${INGEST_PATH}`,
    );
  });

  it("accepts a full ingest url unchanged", () => {
    expect(resolveEndpoint(`https://logs.example.com${INGEST_PATH}`)).toBe(
      `https://logs.example.com${INGEST_PATH}`,
    );
  });

  it("appends beneath a base path", () => {
    expect(resolveEndpoint("https://example.com/logs/")).toBe(
      `https://example.com/logs${INGEST_PATH}`,
    );
  });

  it("discards any query or fragment supplied with the origin", () => {
    expect(resolveEndpoint("https://example.com?debug=1#x")).toBe(
      `https://example.com${INGEST_PATH}`,
    );
  });

  it("discards a query or fragment supplied with a full ingest url too", () => {
    expect(resolveEndpoint(`https://example.com${INGEST_PATH}?debug=1#x`)).toBe(
      `https://example.com${INGEST_PATH}`,
    );
  });

  it("discards credentials embedded in the endpoint, and says so", () => {
    const report = vi.fn();

    const endpoint = resolveEndpoint(
      "https://ada:hunter2@logs.example.com",
      report,
    );

    expect(endpoint).toBe(`https://logs.example.com${INGEST_PATH}`);
    expect(report).toHaveBeenCalledWith(expect.any(Error), "logger.config");
  });

  it("stays quiet when there were no credentials to discard", () => {
    const report = vi.fn();

    resolveEndpoint("https://logs.example.com?x=1", report);

    expect(report).not.toHaveBeenCalled();
  });

  it("refuses a non-http scheme", () => {
    expect(resolveEndpoint("javascript:alert(1)")).toBeUndefined();
    expect(resolveEndpoint("file:///etc/passwd")).toBeUndefined();
  });

  it("refuses a cleartext http endpoint, which would publish the key", () => {
    expect(resolveEndpoint("http://logs.example.com")).toBeUndefined();
    expect(
      resolveEndpoint(`http://logs.example.com${INGEST_PATH}`),
    ).toBeUndefined();
  });

  it("allows http on the loopback host, where local development lives", () => {
    expect(resolveEndpoint("http://localhost:3000")).toBe(
      `http://localhost:3000${INGEST_PATH}`,
    );
    expect(resolveEndpoint("http://127.0.0.1:3000")).toBe(
      `http://127.0.0.1:3000${INGEST_PATH}`,
    );
  });

  it("does not mistake a lookalike host for the loopback one", () => {
    expect(resolveEndpoint("http://localhost.evil.com")).toBeUndefined();
    expect(resolveEndpoint("http://127.0.0.1.evil.com")).toBeUndefined();
  });

  it("refuses a value that is not a url", () => {
    expect(resolveEndpoint("logs.example.com")).toBeUndefined();
  });

  it("reads the environment when nothing is configured", () => {
    vi.stubGlobal("process", {
      env: { STUFFS_LOGGER_ENDPOINT: "https://env.example.com" },
    });

    expect(resolveEndpoint(undefined)).toBe(
      `https://env.example.com${INGEST_PATH}`,
    );
  });

  it("gives up rather than guessing when there is no origin", () => {
    vi.stubGlobal("process", { env: {} });

    expect(resolveEndpoint(undefined)).toBeUndefined();
  });
});
