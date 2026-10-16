import { NextResponse } from "next/server";
import { container } from "@/composition/root";
import { clientIp } from "@/http/rate-limit";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/http/session-cookie";
import { homePathFor } from "@/services/authorization";
import { safeNextPath } from "@/services/magic-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = container();
  const url = new URL(req.url);
  try {
    const { sessionToken, user, expiresAt } = await c.magicLinks.consume(url.searchParams.get("token"));
    await c.audit.append({ action: "auth.magic_link_consumed", actorUserId: user.id, subjectId: user.id, ip: clientIp(req.headers) });
    const next = safeNextPath(url.searchParams.get("next"));
    const res = NextResponse.redirect(new URL(next ?? homePathFor(user.role), req.url), 303);
    res.cookies.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions(Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
    return res;
  } catch {
    return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
  }
}
