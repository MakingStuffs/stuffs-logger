import { describe, expect, it } from "vitest";

import { MAX_APPLICATION_SLUG_LENGTH } from "./limits";
import { APPLICATION_SLUG_PATTERN, suggestSlug } from "./slug";

describe("suggestSlug", () => {
  it("lowercases a name and joins its words with hyphens", () => {
    expect(suggestSlug("Checkout Production")).toBe("checkout-production");
  });

  it("collapses punctuation and repeated separators into one hyphen", () => {
    expect(suggestSlug("Checkout — Production!!  v2")).toBe(
      "checkout-production-v2",
    );
  });

  it("folds accented letters to their base letter", () => {
    expect(suggestSlug("Café Señor")).toBe("cafe-senor");
  });

  it("never starts or ends with a hyphen", () => {
    expect(suggestSlug("  --Admin--  ")).toBe("admin");
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(suggestSlug("—!?")).toBe("");
  });

  it("caps the length without leaving a trailing hyphen", () => {
    const name = `${"a".repeat(MAX_APPLICATION_SLUG_LENGTH - 1)} b`;

    const slug = suggestSlug(name);

    expect(slug.length).toBeLessThanOrEqual(MAX_APPLICATION_SLUG_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("always produces a slug the server pattern accepts", () => {
    for (const name of ["Checkout", "ÉCOLE 42", "my_app.v3", "9 lives"]) {
      expect(suggestSlug(name)).toMatch(APPLICATION_SLUG_PATTERN);
    }
  });
});
