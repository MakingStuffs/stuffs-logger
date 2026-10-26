import { describe, expect, it, vi } from "vitest";

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
        "https://app.example.com/callback#access_token=abc123&expires_in=3600",
        redactor,
      ),
    ).toBe(
      "https://app.example.com/callback#access_token=[redacted]&expires_in=3600",
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

  it("redacts the OAuth and OIDC callback parameters the shared key list does not name", () => {
    expect(
      redactUrl(
        "https://a.com/cb?code=AUTHCODE&state=s&key=K&sig=S#access_token=y",
        redactor,
      ),
    ).toBe(
      "https://a.com/cb?code=[redacted]&state=[redacted]&key=[redacted]&sig=[redacted]#access_token=[redacted]",
    );
  });

  it("matches url-only names whatever their casing or punctuation", () => {
    expect(
      redactUrl("https://a.com/cb#id_token=x&ID-Token=y&nonce=n", redactor),
    ).toBe(
      "https://a.com/cb#id_token=[redacted]&ID-Token=[redacted]&nonce=[redacted]",
    );
  });

  it("matches url-only names exactly, so a postcode or a keyword survives", () => {
    const url = "https://a.com/search?keyword=shoes&postcode=SW1A&page=2";

    expect(redactUrl(url, redactor)).toBe(url);
  });

  it("does not apply the url-only names to context keys", () => {
    for (const key of ["code", "state", "key", "nonce"]) {
      expect(redactor?.shouldRedact(key), key).toBe(false);
    }
  });

  it("never touches a path segment", () => {
    const url = "https://a.com/reset/token/abc123/password/x";

    expect(redactUrl(url, redactor)).toBe(url);
  });

  it("remembers the last url it redacted rather than parsing it again", () => {
    const shouldRedact = vi.fn((key: string) => key === "token");
    const spy = { shouldRedact, replacement: "[redacted]" };
    const url = "https://a.com/?token=1&page=2";

    const first = redactUrl(url, spy);
    const verdicts = shouldRedact.mock.calls.length;
    const second = redactUrl(url, spy);

    expect(second).toBe(first);
    expect(shouldRedact.mock.calls.length).toBe(verdicts);
  });
});
