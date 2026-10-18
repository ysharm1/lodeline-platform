/**
 * Authorization guard + ROLE_NAVIGATION (adapted from LoadEnergy
 * src/services/authorization.ts). Pure, synchronous, fail-closed.
 */
import { AuthorizationError, AuthenticationError } from "@/domain/errors";
import type { AuthContext, Role } from "@/domain/types";

export interface NavigationItem {
  id: string;
  label: string;
  path: string;
}

export const ROLE_NAVIGATION: Record<Role, readonly NavigationItem[]> = {
  buyer: [
    { id: "audits", label: "Parts audits", path: "/audit" },
    { id: "packs", label: "Evidence packs", path: "/buyer/packs" },
    { id: "directory", label: "Supplier directory", path: "/suppliers" },
  ],
  supplier: [
    // Suppliers mainly act through tokenized links (/s/[token]); an account
    // view is a later addition.
    { id: "requests", label: "Evidence requests", path: "/supplier" },
  ],
  admin: [
    { id: "review", label: "Review queue", path: "/admin/review" },
    { id: "packs", label: "Packs", path: "/admin/packs" },
    { id: "suppliers", label: "Suppliers", path: "/admin/suppliers" },
    { id: "applications", label: "Applications", path: "/admin/applications" },
    { id: "verifications", label: "Verifications", path: "/admin/verifications" },
    { id: "refresh", label: "Refresh plans", path: "/admin/refresh" },
    { id: "leads", label: "Leads", path: "/admin/leads" },
    { id: "referrals", label: "Referrals", path: "/admin/referrals" },
    { id: "audit-log", label: "Audit log", path: "/admin/audit-log" },
  ],
};

export function navigationFor(role: Role): readonly NavigationItem[] {
  return ROLE_NAVIGATION[role];
}

export function homePathFor(role: Role): string {
  return ROLE_NAVIGATION[role][0].path;
}

export function requireContext(ctx: AuthContext | null | undefined): AuthContext {
  if (!ctx) throw new AuthenticationError("AUTH_REQUIRED", "Sign in to continue.");
  return ctx;
}

export function requireRole(
  ctx: AuthContext | null | undefined,
  ...roles: Role[]
): AuthContext {
  const c = requireContext(ctx);
  if (!roles.includes(c.role)) {
    throw new AuthorizationError("ROLE_FORBIDDEN", "This action is not available for your role.");
  }
  return c;
}

export const requireAdmin = (ctx: AuthContext | null | undefined) => requireRole(ctx, "admin");
