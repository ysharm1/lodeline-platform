import { container } from "@/composition/root";
import { readJson, route } from "@/http/api";
import { clientIp } from "@/http/rate-limit";
import { json } from "@/http/respond";
import { verifyTurnstile } from "@/http/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Step 1: returns a presigned PUT so the PDF goes straight to storage (no app-server body limit). */
export const POST = route(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const c = container();
  const ip = clientIp(req.headers);
  const rl = await c.limits.supplierUpload.check(ip);
  if (!rl.ok) return json({ error: { code: "RATE_LIMITED", message: "Too many uploads. Try again later." } }, 429, { "Retry-After": String(rl.retryAfterSec) });
  const body = await readJson(req);
  await verifyTurnstile(typeof body.turnstileToken === "string" ? body.turnstileToken : null, ip);
  return json(await c.platform().intake.createUpload(token, { fileName: body.fileName, sizeBytes: body.sizeBytes, stage: body.stage }), 201);
});
