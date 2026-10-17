import { container } from "@/composition/root";
import { readJson, route } from "@/http/api";
import { clientIp } from "@/http/rate-limit";
import { json } from "@/http/respond";
import { verifyTurnstile } from "@/http/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public: lodeline.org readiness-call request or checklist download.
 * Honeypot + per-IP Postgres rate limit + Turnstile (when configured).
 * Body: { kind: "readiness_call" | "checklist", ...fields, botcheck?, turnstileToken? }
 */
export const POST = route(async (req: Request) => {
  const c = container();
  const ip = clientIp(req.headers);
  const body = await readJson(req, 16 * 1024);
  if (body.botcheck) return json({ error: { code: "REJECTED", message: "Rejected." } }, 400);
  const rl = await c.limits.lead.check(`lead:${ip}`);
  if (!rl.ok) return json({ error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later or email info@lodeline.org." } }, 429, { "Retry-After": String(rl.retryAfterSec) });
  await verifyTurnstile(typeof body.turnstileToken === "string" ? body.turnstileToken : null, ip);
  const { turnstileToken: _t, botcheck: _b, ...fields } = body;
  const r = await c.platform().leads.submit(fields, { ip });
  return json({ ok: true, id: r.id, kind: r.kind }, 201);
});
