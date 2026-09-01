import { describe, expect, it } from "vitest";

import { MAX_URL_LENGTH } from "../contract";
import { createRedactor } from "./redact";
import { redactUrl } from "./redact-url";

const redactor = createRedactor(undefined);

describe("redactUrl", () => {
  it("redacts a secret-shaped query parameter", () => {
    expect(
      redactUrl(
        "https://app.example.com/reset?token=abc123&user=ada",
        redactor,
      ),
    ).toBe("https://app.example.com/reset?token=[redacted]&user=ada");
  });

  it("redacts secret-shaped fragment parameters, where OAuth puts tokens", () => {
    expect(
      redactUrl(
        "https://app.example.com/callback#access_token=abc123&state=xyz",
        redactor,
      ),
    ).toBe(
      "https://app.example.com/callback#access_token=[redacted]&state=xyz",
    );
  });

  it("matches parameter names the same way context keys are matched", () => {
    const url = redactUrl(
      "https://app.example.com/?API_KEY=1&x-auth-token=2&reset_password=3",
      redactor,
    );

    expect(url).not.toContain("=1");
    expect(url).not.toContain("=2");
    expect(url).not.toContain("=3");
  });

  it("leaves an ordinary url untouched", () => {
    const url = "https://app.example.com/products?page=2&sort=price#reviews";

    expect(redactUrl(url, redactor)).toBe(url);
  });

  it("strips credentials embedded in the authority", () => {
    const url = redactUrl("https://ada:hunter2@app.example.com/", redactor);

    expect(url).not.toContain("hunter2");
    expect(url).not.toContain("ada");
  });

  it("uses the configured replacement", () => {
    expect(
      redactUrl(
        "https://app.example.com/?token=abc",
        createRedactor({ replacement: "***" }),
      ),
    ).toBe("https://app.example.com/?token=***");
  });

  it("cannot inject a new parameter through the replacement", () => {
    const url = redactUrl(
      "https://app.example.com/?token=abc&page=2",
      createRedactor({ replacement: "&admin=1#" }),
    );

    expect(url).toBe("https://app.example.com/?token=admin1&page=2");
  });

  it("stays within the contract's url length after redacting", () => {
    const url = `https://app.example.com/?token=${"a".repeat(MAX_URL_LENGTH)}`;

    expect(redactUrl(url, redactor).length).toBeLessThanOrEqual(MAX_URL_LENGTH);
  });

  it("leaves the url alone when redaction is switched off", () => {
    const url = "https://app.example.com/?token=abc";

    expect(redactUrl(url, undefined)).toBe(url);
  });

  it("returns a value it cannot parse unchanged rather than throwing", () => {
    expect(redactUrl("not a url at all", redactor)).toBe("not a url at all");
  });
});
