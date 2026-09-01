import { describe, expect, it } from "vitest";

import { parseUserAgent } from "./user-agent";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAC_FIREFOX =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0";
const ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";

describe("parseUserAgent", () => {
  it("returns unknowns for an absent user agent", () => {
    expect(parseUserAgent(null)).toEqual({
      deviceType: "unknown",
      os: null,
      browser: null,
    });
    expect(parseUserAgent(undefined)).toEqual({
      deviceType: "unknown",
      os: null,
      browser: null,
    });
    expect(parseUserAgent("")).toEqual({
      deviceType: "unknown",
      os: null,
      browser: null,
    });
  });

  it("identifies an iPhone", () => {
    expect(parseUserAgent(IPHONE)).toEqual({
      deviceType: "mobile",
      os: "iOS",
      browser: "Safari",
    });
  });

  it("identifies an iPad as a tablet", () => {
    expect(parseUserAgent(IPAD).deviceType).toBe("tablet");
  });

  it("identifies desktop Chrome on Windows", () => {
    expect(parseUserAgent(WINDOWS_CHROME)).toEqual({
      deviceType: "desktop",
      os: "Windows",
      browser: "Chrome",
    });
  });

  it("identifies Firefox on macOS", () => {
    expect(parseUserAgent(MAC_FIREFOX)).toEqual({
      deviceType: "desktop",
      os: "macOS",
      browser: "Firefox",
    });
  });

  it("distinguishes an Android phone from an Android tablet", () => {
    expect(parseUserAgent(ANDROID_PHONE).deviceType).toBe("mobile");
    expect(parseUserAgent(ANDROID_TABLET).deviceType).toBe("tablet");
  });

  it("prefers Edge over the Chrome and Safari tokens it also carries", () => {
    expect(parseUserAgent(EDGE).browser).toBe("Edge");
  });

  it.each([
    ["Googlebot/2.1 (+http://www.google.com/bot.html)"],
    ["curl/8.4.0"],
    ["python-requests/2.31.0"],
    ["Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0"],
  ])("classifies %s as a bot", (userAgent) => {
    expect(parseUserAgent(userAgent).deviceType).toBe("bot");
  });

  it("never echoes the input into the derived fields", () => {
    const hostile = "<script>alert(1)</script> Windows NT 10.0 Chrome/120";
    const parsed = parseUserAgent(hostile);

    expect(parsed.os).toBe("Windows");
    expect(parsed.browser).toBe("Chrome");
    expect(JSON.stringify(parsed)).not.toContain("script");
  });

  it("handles an absurdly long user agent without failing", () => {
    const parsed = parseUserAgent(`${"a".repeat(100_000)} Windows NT 10.0`);

    // Only the bounded prefix is inspected, so the trailing token is not seen.
    expect(parsed.deviceType).toBe("unknown");
  });
});
