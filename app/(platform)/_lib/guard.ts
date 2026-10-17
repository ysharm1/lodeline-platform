import { notFound, redirect } from "next/navigation";
import type { AuthContext, Role } from "@/domain/types";
import { getAuthContext } from "@/http/auth-context";

/** Page guard: unauthenticated -> /login, wrong role -> 404 (no existence leak). */
export async function requirePageRole(...roles: Role[]): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (roles.length && !roles.includes(ctx.role)) notFound();
  return ctx;
}
