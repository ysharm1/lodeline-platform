import { container } from "@/composition/root";
import { route } from "@/http/api";
import { clientIp } from "@/http/rate-limit";
import { json } from "@/http/respond";
import { DEMO_FILE_NAME, DEMO_LEAD_EMAIL, demoCsvBytes } from "@/services/demo-sample";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public free demo: runs the fictional sample parts list through the real free-audit pipeline. */
export const POST = route(async (req: Request) => {
  const c = container();
  const ip = clientIp(req.headers);
  const rl = await c.limits.audit.check(`audit:${ip}`);
  if (!rl.ok) return json({ error: { code: "RATE_LIMITED", message: "Too many audits. Try again later." } }, 429, { "Retry-After": String(rl.retryAfterSec) });
  const r = await c.freeAudit.run({ fileName: DEMO_FILE_NAME, bytes: demoCsvBytes(), leadEmail: DEMO_LEAD_EMAIL, companyName: "Example Motion Co. (fictional demo)", ip });
  return json({ ...r, redirect: `/audit/${r.auditId}?t=${encodeURIComponent(r.accessToken)}&demo=1` }, 201);
});
