import { describe, expect, it } from "vitest";
import { canActAs, effectiveOrgRoles, orgRoleForLegacy, withRole } from "./memberships";

describe("dual-role memberships", () => {
  it("an organization can be buyer and seller; members hold roles per membership", () => {
    const org = ["buyer", "seller"] as const;
    expect(effectiveOrgRoles(org, ["buyer"])).toEqual(["buyer"]);
    expect(effectiveOrgRoles(org, ["buyer", "seller"])).toEqual(["buyer", "seller"]);
    expect(canActAs("seller", org, ["seller"])).toBe(true);
    expect(canActAs("seller", org, ["buyer"])).toBe(false);
  });

  it("a member cannot exceed what the organization is enabled for", () => {
    expect(effectiveOrgRoles(["buyer"], ["buyer", "seller"])).toEqual(["buyer"]);
    expect(canActAs("seller", ["buyer"], ["seller"])).toBe(false);
  });

  it("legacy roles map and capabilities are additive", () => {
    expect(orgRoleForLegacy("supplier")).toBe("seller");
    expect(orgRoleForLegacy("buyer")).toBe("buyer");
    expect(orgRoleForLegacy("admin")).toBe("buyer");
    expect(withRole(["buyer"], "seller")).toEqual(["buyer", "seller"]);
    expect(withRole(["buyer", "seller"], "seller")).toEqual(["buyer", "seller"]);
  });
});
