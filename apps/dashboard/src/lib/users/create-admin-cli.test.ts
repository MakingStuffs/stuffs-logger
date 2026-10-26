import { describe, expect, it } from "vitest";

import { parseCreateAdminArgs } from "./create-admin-cli";

const ARGS = ["--email", "You@Example.test", "--name", "You"];

describe("parseCreateAdminArgs", () => {
  it("accepts an email and a name, normalising the address", () => {
    expect(parseCreateAdminArgs(ARGS, {})).toEqual({
      ok: true,
      email: "you@example.test",
      name: "You",
    });
  });

  it("ignores the bare -- pnpm forwards", () => {
    expect(parseCreateAdminArgs(["--", ...ARGS], {})).toMatchObject({
      ok: true,
    });
  });

  it.each([["SKIP_AUTH"], ["NEXT_PUBLIC_SKIP_AUTH"]])(
    "refuses to run with %s set",
    (name) => {
      expect(parseCreateAdminArgs(ARGS, { [name]: "true" })).toMatchObject({
        ok: false,
        message: expect.stringContaining("SKIP_AUTH"),
      });
    },
  );

  it("refuses a missing email", () => {
    expect(parseCreateAdminArgs(["--name", "You"], {})).toMatchObject({
      ok: false,
      message: expect.stringContaining("--email"),
    });
  });

  it("refuses a missing name", () => {
    expect(
      parseCreateAdminArgs(["--email", "you@example.test"], {}),
    ).toMatchObject({ ok: false, message: expect.stringContaining("--name") });
  });

  it("refuses an address that is not one", () => {
    expect(
      parseCreateAdminArgs(["--email", "nope", "--name", "You"], {}),
    ).toMatchObject({ ok: false });
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    // A typo like `--role MEMBER` must not silently create an ADMIN.
    expect(
      parseCreateAdminArgs([...ARGS, "--role", "MEMBER"], {}),
    ).toMatchObject({ ok: false });
  });
});
