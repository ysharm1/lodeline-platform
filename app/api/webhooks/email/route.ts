import { container } from "@/composition/root";
import { route } from "@/http/api";
import { json } from "@/http/respond";
import { handleEmailWebhook } from "@/services/email-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resend (Svix-signed) or Postmark (basic auth) delivery/open/bounce events. */
export const POST = route(async (req: Request) => {
  const raw = await req.text();
  if (raw.length > 256 * 1024) return json({ error: { code: "BODY_TOO_LARGE", message: "Too large" } }, 413);
  const r = await handleEmailWebhook(container().platform().deps, req.headers, raw, process.env.EMAIL_WEBHOOK_SECRET);
  return json(r);
});
