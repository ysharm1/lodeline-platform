import { container } from "@/composition/root";
import { DomainError } from "@/domain/errors";
import { clientIp } from "@/http/rate-limit";
import { errorResponse, json } from "@/http/respond";
import { verifyTurnstile } from "@/http/turnstile";
import { MAX_UPLOAD_BYTES } from "@/services/parts-parser";
import { getAuthContext } from "@/http/auth-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: multipart CSV/XLSX upload. Turnstile + per-IP rate limit + size caps. */
export async function POST(req: Request) {
  try {
    const c = container();
    const ip = clientIp(req.headers);
    const rl = c.limits.audit.check(`audit:${ip}`);
    if (!rl.ok) return json({ error: { code: "RATE_LIMITED", message: "Too many uploads. Try again later." } }, 429, { "Retry-After": String(rl.retryAfterSec) });

    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_UPLOAD_BYTES + 64 * 1024) throw new DomainError("payload_too_large", "FILE_TOO_LARGE", "Files must be 5 MB or smaller.", "file");

    const form = await req.formData();
    if (form.get("website")) return json({ error: { code: "REJECTED", message: "Rejected." } }, 400);
    await verifyTurnstile(form.get("cf-turnstile-response") as string | null, ip);

    const file = form.get("file");
    if (!(file instanceof File)) throw new DomainError("validation", "FILE_REQUIRED", "Attach a parts list.", "file");
    if (file.size > MAX_UPLOAD_BYTES) throw new DomainError("payload_too_large", "FILE_TOO_LARGE", "Files must be 5 MB or smaller.", "file");

    const ctx = await getAuthContext();
    const result = await c.freeAudit.run({
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      leadEmail: form.get("email"),
      companyName: form.get("company"),
      ip,
      actorUserId: ctx?.userId ?? null,
    });
    // TODO(week 1 follow-up): email the results link to leadEmail.
    return json(result, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
