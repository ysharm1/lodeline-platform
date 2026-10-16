import { container } from "@/composition/root";
import { route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stripe webhook: signature-verified (raw body), idempotent by event id. */
export const POST = route(async (req: Request) => {
  const raw = await req.text();
  const p = container().platform();
  const ev = await p.deps.billing.parseWebhook(raw, req.headers.get("stripe-signature"));
  if (ev.type === "checkout.completed" && ev.packId && ev.checkoutId) {
    await p.packs.markPaid(ev.packId, ev.checkoutId, ev.amountCents, ev.id);
  }
  return json({ received: true });
});
