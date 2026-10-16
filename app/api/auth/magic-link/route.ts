import { NextResponse } from "next/server";
import { container } from "@/composition/root";
import { clientIp } from "@/http/rate-limit";
import { errorResponse } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const c = container();
    const ip = clientIp(req.headers);
    const form = await req.formData();
    const rl = await c.limits.magicLink.check(`ml:${ip}`);
    if (rl.ok) {
      const { id, email } = await c.magicLinks.request(form.get("email"));
      await c.audit.append({ action: "auth.magic_link_requested", subjectId: id, payload: { emailDomain: email.split("@")[1] }, ip });
    }
    // Same response either way: no account or rate-limit enumeration.
    return NextResponse.redirect(new URL("/login?sent=1", req.url), 303);
  } catch (e) {
    return errorResponse(e);
  }
}
