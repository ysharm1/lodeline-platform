import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { container } from "@/composition/root";
import { SESSION_COOKIE_NAME } from "@/http/session-cookie";
import { hashSessionToken } from "@/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const c = container();
    const h = hashSessionToken(token);
    const s = await c.sessions.findByTokenHash(h);
    await c.sessions.deleteByTokenHash(h);
    if (s) await c.audit.append({ action: "auth.logout", actorUserId: s.userId, subjectId: s.userId });
  }
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}
