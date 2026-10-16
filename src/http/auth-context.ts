/** Resolves AuthContext from the session cookie (server components + routes). */
import { cookies } from "next/headers";
import type { AuthContext } from "@/domain/types";
import { container } from "@/composition/root";
import { hashSessionToken, isSessionExpired } from "@/session/store";
import { SESSION_COOKIE_NAME } from "./session-cookie";

export async function getAuthContext(): Promise<AuthContext | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const c = container();
  const s = await c.sessions.findByTokenHash(hashSessionToken(token));
  if (!s || isSessionExpired(s, new Date())) return null;
  const u = await c.repo.findUserById(s.userId);
  return u ? { userId: u.id, role: u.role, orgId: u.orgId, email: u.email } : null;
}
