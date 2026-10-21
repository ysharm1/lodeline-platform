/**
 * Organization helpers for dual-role accounts (docs/architecture.md).
 * An organization is created lazily the first time a user needs one (ordering
 * a pack, or listing its own supplies). Adding the seller role keeps the buyer
 * role: one company can buy evidence packs and list what it supplies.
 */
import type { OrgRole } from "@prisma/client";
import type { AuthContext } from "@/domain/types";
import type { PlatformDeps } from "./deps";
import { effectiveOrgRoles, withRole } from "./memberships";
import { AuthorizationError, ValidationError } from "@/domain/errors";

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

/**
 * Customer onboarding: name the company. Creates the org (buyer role) and the
 * creator's org-admin membership on first call; later calls rename it (org admins only).
 */
export async function setupOrg(d: Pick<PlatformDeps, "db" | "audit">, ctx: AuthContext, rawName: unknown): Promise<{ orgId: string; created: boolean }> {
  const name = typeof rawName === "string" ? rawName.trim().slice(0, 200) : "";
  if (name.length < 2) throw new ValidationError("ORG_NAME_REQUIRED", "Enter your company name.", "name");
  if (ctx.role !== "buyer" && ctx.role !== "admin") throw new AuthorizationError("ROLE_FORBIDDEN", "Company accounts are for buyers.");
  if (!ctx.orgId) {
    const orgId = await ensureOrg(d, ctx, name, ["buyer"]);
    await d.audit.append({ action: "org.created", actorUserId: ctx.userId, subjectId: orgId, payload: { name } });
    return { orgId, created: true };
  }
  const m = await d.db.membership.findUnique({ where: { userId_orgId: { userId: ctx.userId, orgId: ctx.orgId } } });
  if (!m?.isOrgAdmin) throw new AuthorizationError("ORG_ADMIN_REQUIRED", "Only an org admin can rename the company.");
  await d.db.organization.update({ where: { id: ctx.orgId }, data: { name } });
  await d.audit.append({ action: "org.renamed", actorUserId: ctx.userId, subjectId: ctx.orgId, payload: { name } });
  return { orgId: ctx.orgId, created: false };
}

/** Org, the user's membership roles there, and the effective roles. */
export async function orgSummary(d: Pick<PlatformDeps, "db">, ctx: AuthContext) {
  if (!ctx.orgId) return null;
  const org = await d.db.organization.findUnique({ where: { id: ctx.orgId }, include: { memberships: { where: { userId: ctx.userId } } } });
  if (!org) return null;
  const m = org.memberships[0];
  const roles = effectiveOrgRoles(org.roles, m?.roles ?? []);
  return { id: org.id, name: org.name, roles, isOrgAdmin: !!m?.isOrgAdmin, isSeller: roles.includes("seller") };
}
