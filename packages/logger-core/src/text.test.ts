import { describe, expect, it } from "vitest";

import {
  sanitiseJsonText,
  sanitiseLogText,
  sanitiseOptionalLogText,
} from "./text";

/** Built from code points: the characters under test are invisible. */
const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);
const NUL = String.fromCodePoint(0x00);
const BACKSPACE = String.fromCodePoint(0x08);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const POP_DIRECTIONAL = String.fromCodePoint(0x202c);
const FIRST_STRONG_ISOLATE = String.fromCodePoint(0x2068);
const LONE_HIGH_SURROGATE = String.fromCodePoint(0xd83d);
const LONE_LOW_SURROGATE = String.fromCodePoint(0xde00);
const REPLACEMENT_CHARACTER = String.fromCodePoint(0xfffd);

describe("sanitiseLogText", () => {
  it("removes an ANSI colour sequence and keeps the text", () => {
    expect(sanitiseLogText(`${ESC}[31mred${ESC}[0m`)).toBe("red");
  });

  it("removes an ANSI cursor-movement sequence", () => {
    expect(sanitiseLogText(`before${ESC}[2Jafter`)).toBe("beforeafter");
  });

  it("removes an OSC sequence including its terminator", () => {
    expect(sanitiseLogText(`${ESC}]0;window title${BEL}text`)).toBe("text");
  });

  it("removes an OSC sequence terminated by ESC backslash", () => {
    expect(sanitiseLogText(`${ESC}]8;;https://x.test${ESC}\\link`)).toBe(
      "link",
    );
  });

  it("keeps the text after an OSC introducer that is never terminated", () => {
    // An optional terminator let this match to the end of the string and the
    // whole message vanished; only the ESC ] itself may go.
    expect(sanitiseLogText(`${ESC}]important: payment failed`)).toBe(
      "important: payment failed",
    );
  });

  it("keeps the text when an OSC payload is implausibly long", () => {
    // Over the payload bound the ESC ] is treated as a stray introducer: it
    // goes, the text stays, and the BEL goes as an ordinary control.
    const payload = "p".repeat(5000);

    expect(sanitiseLogText(`${ESC}]${payload}${BEL}`)).toBe(payload);
  });

  it("leaves no stranded payload when an escape is stripped", () => {
    expect(sanitiseLogText(`${ESC}[31mred`)).not.toContain("[31m");
  });

  it("removes C0 control characters", () => {
    expect(sanitiseLogText(`a${NUL}b${BACKSPACE}c`)).toBe("abc");
  });

  it("keeps newlines so a stack trace stays readable", () => {
    expect(sanitiseLogText("at foo\n  at bar")).toBe("at foo\n  at bar");
  });

  it("keeps tabs", () => {
    expect(sanitiseLogText("a\tb")).toBe("a\tb");
  });

  it("normalises a carriage return to a newline rather than dropping it", () => {
    expect(sanitiseLogText("line one\r\nline two\rline three")).toBe(
      "line one\nline two\nline three",
    );
  });

  it("removes a right-to-left override", () => {
    const spoofed = `deleted ${RIGHT_TO_LEFT_OVERRIDE}resu${POP_DIRECTIONAL}`;

    expect(sanitiseLogText(spoofed)).toBe("deleted resu");
  });

  it("removes directional isolates", () => {
    expect(sanitiseLogText(`a${FIRST_STRONG_ISOLATE}b`)).toBe("ab");
  });

  it("leaves ordinary text, punctuation and emoji untouched", () => {
    const text = "Payment failed for order #42 (retry in 5s) 🚨";

    expect(sanitiseLogText(text)).toBe(text);
  });

  it("leaves an empty string empty", () => {
    expect(sanitiseLogText("")).toBe("");
  });

  describe("lone surrogates", () => {
    /**
     * Runs `fn` with `String.prototype.toWellFormed` hidden, so the regex
     * fallback that older browsers reach is exercised here on a runtime that
     * has the native method. On one that does not, `fn` simply runs as-is.
     */
    function withoutNativeToWellFormed<T>(fn: () => T): T {
      const descriptor = Object.getOwnPropertyDescriptor(
        String.prototype,
        "toWellFormed",
      );
      if (descriptor === undefined) return fn();

      Object.defineProperty(String.prototype, "toWellFormed", {
        ...descriptor,
        value: undefined,
      });
      try {
        return fn();
      } finally {
        Object.defineProperty(String.prototype, "toWellFormed", descriptor);
      }
    }

    it("replaces a lone high surrogate left by a cut at a UTF-16 boundary", () => {
      expect(sanitiseLogText(`emoji ${LONE_HIGH_SURROGATE}`)).toBe(
        `emoji ${REPLACEMENT_CHARACTER}`,
      );
    });

    it("replaces a lone low surrogate", () => {
      expect(sanitiseLogText(`${LONE_LOW_SURROGATE} tail`)).toBe(
        `${REPLACEMENT_CHARACTER} tail`,
      );
    });

    it("keeps a well-formed surrogate pair", () => {
      expect(sanitiseLogText("ok 😀")).toBe("ok 😀");
    });

    it("replaces unpaired halves without the native toWellFormed", () => {
      const input = `${LONE_LOW_SURROGATE}a${LONE_HIGH_SURROGATE}😀${LONE_HIGH_SURROGATE}`;

      const result = withoutNativeToWellFormed(() => sanitiseLogText(input));

      expect(result).toBe(
        `${REPLACEMENT_CHARACTER}a${REPLACEMENT_CHARACTER}😀${REPLACEMENT_CHARACTER}`,
      );
    });

    it("keeps a well-formed pair without the native toWellFormed", () => {
      expect(withoutNativeToWellFormed(() => sanitiseLogText("ok 😀"))).toBe(
        "ok 😀",
      );
    });

    it("judges well-formedness on the output, after the earlier passes", () => {
      // Stripping the NUL brings the two halves together. Repairing first
      // would store two U+FFFD; repairing last stores the pair they now form,
      // and either way nothing unpaired reaches the database.
      const input = `${LONE_HIGH_SURROGATE}${NUL}${LONE_LOW_SURROGATE}`;

      expect(sanitiseLogText(input)).toBe("😀");
    });
  });
});

describe("sanitiseOptionalLogText", () => {
  it("returns null for an absent value", () => {
    expect(sanitiseOptionalLogText(null)).toBeNull();
    expect(sanitiseOptionalLogText(undefined)).toBeNull();
  });

  it("sanitises a present value", () => {
    expect(sanitiseOptionalLogText(`${ESC}[1mbold`)).toBe("bold");
  });
});

describe("sanitiseJsonText", () => {
  it("sanitises string values at every level", () => {
    const input = {
      message: `${ESC}[31mred`,
      nested: { deeper: [`a${NUL}b`] },
    };

    expect(sanitiseJsonText(input)).toEqual({
      message: "red",
      nested: { deeper: ["ab"] },
    });
  });

  it("sanitises keys as well as values", () => {
    const input = { [`bad${NUL}key`]: "value" };

    expect(sanitiseJsonText(input)).toEqual({ badkey: "value" });
  });

  it("keeps a key that sanitises to __proto__ rather than losing it", () => {
    // The NUL is invisible in a dashboard, so this key reads as "__proto__"
    // and only BECOMES it once sanitised. Assigning it would run the
    // Object.prototype setter: the entry would vanish and the object value
    // would become the result's prototype.
    const input = { [`__pro${NUL}to__`]: { nested: "value" }, id: "1" };

    const result = sanitiseJsonText(input);

    expect(Object.keys(result as object)).toEqual(["__proto__", "id"]);
    expect((result as Record<string, unknown>)["__proto__"]).toEqual({
      nested: "value",
    });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    // The entry survives serialisation, which is where it is going.
    expect(JSON.stringify(result)).toContain("__proto__");
  });

  it("leaves Object.prototype alone when a key sanitises to __proto__", () => {
    sanitiseJsonText({ [`__pro${NUL}to__`]: { polluted: true } });

    expect("polluted" in {}).toBe(false);
  });

  it("leaves non-string leaves alone", () => {
    const input = { count: 2, flag: true, missing: null };

    expect(sanitiseJsonText(input)).toEqual(input);
  });

  it("does not mutate the input", () => {
    const input = { message: `${ESC}[31mred` };

    sanitiseJsonText(input);

    expect(input.message).toBe(`${ESC}[31mred`);
  });
});
