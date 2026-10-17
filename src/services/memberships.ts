/**
 * Dual-role accounts (buyer + seller per organization). Pure helpers only:
 * selling is not built yet, but every check that needs "can this user act as a
 * buyer/seller for this org" should go through here so a seller side can be
 * added without touching callers.
 */
import type { OrgRole, Role } from "@/domain/types";

/** Effective roles = what the member holds ∩ what the organization is enabled for. */
export function effectiveOrgRoles(orgRoles: readonly OrgRole[], membershipRoles: readonly OrgRole[]): OrgRole[] {
  const org = new Set(orgRoles);
  return [...new Set(membershipRoles)].filter((r) => org.has(r));
}

export function canActAs(role: OrgRole, orgRoles: readonly OrgRole[], membershipRoles: readonly OrgRole[]): boolean {
  return effectiveOrgRoles(orgRoles, membershipRoles).includes(role);
}

/** Maps the legacy single platform role to the org role it implies (admins act as buyers in an org). */
export function orgRoleForLegacy(role: Role): OrgRole {
  return role === "supplier" ? "seller" : "buyer";
}

/** Adds a role to an org's capabilities without dropping existing ones (e.g. a buyer org that starts selling). */
export function withRole(roles: readonly OrgRole[], add: OrgRole): OrgRole[] {
  return roles.includes(add) ? [...roles] : [...roles, add];
}
