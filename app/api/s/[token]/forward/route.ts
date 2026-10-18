import { container } from "@/composition/root";
import { readJson, route } from "@/http/api";
import { clientIp } from "@/http/rate-limit";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Supplier forwards some of its requested stages to its own upstream supplier { stages, name, contactEmail, contactName?, country? }. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const c = container();
  const rl = await c.limits.supplierUpload.check(`fwd:${clientIp(req.headers)}`);
  if (!rl.ok) return json({ error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } }, 429, { "Retry-After": String(rl.retryAfterSec) });
  const body = await readJson(req);
  return json(await c.platform().suppliers.forward(token, body), 201);
});
