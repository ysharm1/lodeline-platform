import { container } from "@/composition/root";
import { readJson, route } from "@/http/api";
import { clientIp } from "@/http/rate-limit";
import { json } from "@/http/respond";
import { verifyTurnstile } from "@/http/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: "For suppliers" application to be listed as a documented source (goes to the admin queue). */
export const POST = route(async (req: Request) => {
  const c = container();
  const ip = clientIp(req.headers);
  const body = await readJson(req, 16 * 1024);
  if (body.botcheck) return json({ error: { code: "REJECTED", message: "Rejected." } }, 400);
  const rl = await c.limits.supplierApply.check(`apply:${ip}`);
  if (!rl.ok) return json({ error: { code: "RATE_LIMITED", message: "Too many applications. Please try again later." } }, 429, { "Retry-After": String(rl.retryAfterSec) });
  await verifyTurnstile(typeof body.turnstileToken === "string" ? body.turnstileToken : null, ip);
  const { turnstileToken: _t, botcheck: _b, ...fields } = body;
  const r = await c.platform().applications.submit(fields, { ip });
  return json({ ok: true, ...r }, 201);
});
