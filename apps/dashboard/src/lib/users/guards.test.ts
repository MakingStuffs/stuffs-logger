import { describe, expect, it } from "vitest";

import {
  checkDeactivation,
  checkPasswordReset,
  checkRoleChange,
  confirmsEmail,
} from "./guards";
import type { GuardTarget } from "./guards";

const ACTOR_ID = "admin-1";

function makeTarget(overrides: Partial<GuardTarget> = {}): GuardTarget {
  return { id: "user-2", role: "MEMBER", isActive: true, ...overrides };
}

describe("checkRoleChange", () => {
  it("allows promoting a member", () => {
    expect(checkRoleChange(ACTOR_ID, makeTarget(), "ADMIN", 1)).toBeNull();
  });

  it("allows demoting an admin while another active admin remains", () => {
    expect(
      checkRoleChange(ACTOR_ID, makeTarget({ role: "ADMIN" }), "MEMBER", 2),
    ).toBeNull();
  });

  it("refuses an admin demoting themself", () => {
    expect(
      checkRoleChange(
        ACTOR_ID,
        makeTarget({ id: ACTOR_ID, role: "ADMIN" }),
        "MEMBER",
        5,
      ),
    ).toBe("SELF");
  });

  it("refuses demoting the last active admin", () => {
    expect(
      checkRoleChange(ACTOR_ID, makeTarget({ role: "ADMIN" }), "MEMBER", 1),
    ).toBe("LAST_ADMIN");
  });

  it("does not count a deactivated admin as the last one", () => {
    // A deactivated admin holds no live admin standing, so demoting them
    // cannot leave the organisation without one.
    expect(
      checkRoleChange(
        ACTOR_ID,
        makeTarget({ role: "ADMIN", isActive: false }),
        "MEMBER",
        1,
      ),
    ).toBeNull();
  });
});

describe("checkDeactivation", () => {
  it("allows deactivating a member", () => {
    expect(checkDeactivation(ACTOR_ID, makeTarget(), 1)).toBeNull();
  });

  it("refuses an admin deactivating themself", () => {
    expect(
      checkDeactivation(
        ACTOR_ID,
        makeTarget({ id: ACTOR_ID, role: "ADMIN" }),
        3,
      ),
    ).toBe("SELF");
  });

  it("refuses deactivating the last active admin", () => {
    expect(checkDeactivation(ACTOR_ID, makeTarget({ role: "ADMIN" }), 1)).toBe(
      "LAST_ADMIN",
    );
  });

  it("allows deactivating an admin while another active admin remains", () => {
    expect(
      checkDeactivation(ACTOR_ID, makeTarget({ role: "ADMIN" }), 2),
    ).toBeNull();
  });
});

describe("checkPasswordReset", () => {
  it("allows resetting someone else", () => {
    expect(checkPasswordReset(ACTOR_ID, makeTarget())).toBeNull();
  });

  it("refuses an admin resetting themself", () => {
    expect(checkPasswordReset(ACTOR_ID, makeTarget({ id: ACTOR_ID }))).toBe(
      "SELF",
    );
  });
});

describe("confirmsEmail", () => {
  it("accepts the address retyped", () => {
    expect(confirmsEmail("ada@example.test", "ada@example.test")).toBe(true);
  });

  it("forgives case and surrounding space", () => {
    expect(confirmsEmail("  Ada@Example.TEST ", "ada@example.test")).toBe(true);
  });

  it("refuses a different address", () => {
    expect(confirmsEmail("ad@example.test", "ada@example.test")).toBe(false);
  });

  it("refuses an empty confirmation", () => {
    expect(confirmsEmail("   ", "")).toBe(false);
  });
});
