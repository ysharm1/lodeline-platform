import { container } from "@/composition/root";
import { readJson, route } from "@/http/api";
import { clientIp } from "@/http/rate-limit";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supplier (no login, private link): { consent: true, name } lets Lodeline keep
 * the reviewed documents from this request and reuse them for the supplier's
 * other customers; { consent: false } withdraws that permission.
 */
export const POST = route(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const c = container();
  const rl = await c.limits.supplierUpload.check(clientIp(req.headers));
  if (!rl.ok) return json({ error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } }, 429, { "Retry-After": String(rl.retryAfterSec) });
  const body = await readJson(req);
  return json(await c.platform().suppliers.setReuseConsent(token, { consent: body.consent, name: body.name }));
});
