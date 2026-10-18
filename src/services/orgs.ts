/**
 * Organization helpers for dual-role accounts (docs/architecture.md).
 * An organization is created lazily the first time a user needs one (ordering
 * a pack, or listing its own supplies). Adding the seller role keeps the buyer
 * role: one company can buy evidence packs and list what it supplies.
 */
import type { OrgRole } from "@prisma/client";
import type { AuthContext } from "@/domain/types";
import type { PlatformDeps } from "./deps";
import { withRole } from "./memberships";

export async function ensureOrg(d: Pick<PlatformDeps, "db">, ctx: AuthContext, name: string | null, roles: OrgRole[] = ["buyer"]): Promise<string> {
  if (ctx.orgId) return ctx.orgId;
  const org = await d.db.organization.create({ data: { name: name ?? ctx.email.split("@")[1], kind: roles.includes("buyer") ? "buyer" : "supplier", roles } });
  await d.db.user.update({ where: { id: ctx.userId }, data: { orgId: org.id } });
  // The creator is a member with the same roles and is org admin.
  await d.db.membership.create({ data: { userId: ctx.userId, orgId: org.id, roles, isOrgAdmin: true } });
  return org.id;
}

/** Enables `role` on the org and on the user's membership there (creating the membership if missing). */
export async function grantOrgRole(d: Pick<PlatformDeps, "db">, userId: string, orgId: string, role: OrgRole): Promise<void> {
  const org = await d.db.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (!org.roles.includes(role)) await d.db.organization.update({ where: { id: orgId }, data: { roles: withRole(org.roles, role) } });
  const m = await d.db.membership.findUnique({ where: { userId_orgId: { userId, orgId } } });
  if (!m) await d.db.membership.create({ data: { userId, orgId, roles: withRole(["buyer"], role), isOrgAdmin: true } });
  else if (!m.roles.includes(role)) await d.db.membership.update({ where: { id: m.id }, data: { roles: withRole(m.roles, role) } });
}
