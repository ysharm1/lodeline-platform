import { container } from "@/composition/root";
import { route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook: signature-verified (raw body), idempotent by event id.
 * Each paid checkout carries metadata.kind, which says what was bought:
 *   pack          -> mark the evidence pack paid and start supplier outreach
 *   verification  -> mark the supplier verification paid and send the upload link
 *   refresh       -> activate the buyer's monthly refresh plan
 * A cancelled subscription ends the refresh plan.
 */
export const POST = route(async (req: Request) => {
  const raw = await req.text();
  const p = container().platform();
  const ev = await p.deps.billing.parseWebhook(raw, req.headers.get("stripe-signature"));
  if (ev.type === "checkout.completed" && ev.refId && ev.checkoutId) {
    if (ev.kind === "pack") await p.packs.markPaid(ev.refId, ev.checkoutId, ev.amountCents, ev.id);
    else if (ev.kind === "verification") await p.verifications.markPaid(ev.refId, ev.checkoutId, ev.amountCents, ev.id);
    else if (ev.kind === "refresh") await p.refresh.activate(ev.refId, ev.checkoutId, ev.subscriptionId, ev.id);
  } else if (ev.type === "subscription.ended" && ev.subscriptionId) {
    await p.refresh.end(ev.subscriptionId, ev.id);
  }
  return json({ received: true });
});
