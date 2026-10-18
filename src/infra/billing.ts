/**
 * Billing port. StripeBilling uses Checkout (test-mode keys in non-prod).
 * DevBilling (no STRIPE_SECRET_KEY, non-production only) completes checkouts
 * immediately so the flows can be exercised locally.
 *
 * One Checkout integration sells three things. Each session carries
 * metadata { kind, refId } so the webhook knows what was bought:
 *   - kind "pack"          one-time payment for an evidence pack (refId = pack id)
 *   - kind "verification"  one-time annual fee paid by a supplier (refId = verification id)
 *   - kind "refresh"       monthly subscription to keep a pack current (refId = refresh id)
 * Prices come from src/services/pricing.ts.
 */
import Stripe from "stripe";
import { DomainError } from "@/domain/errors";

export type CheckoutKind = "pack" | "verification" | "refresh";

export interface CheckoutInput {
  kind: CheckoutKind;
  /** Id of the pack, verification or refresh row being paid for. */
  refId: string;
  /** One-time amount, or the monthly amount when `monthly` is true. */
  priceCents: number;
  productName: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /** true = monthly subscription (refresh plans). */
  monthly?: boolean;
}
export interface BillingEvent {
  id: string;
  type: "checkout.completed" | "subscription.ended" | "ignored";
  kind?: CheckoutKind;
  refId?: string;
  /** Kept for older pack sessions that only carry metadata.packId. */
  packId?: string;
  checkoutId?: string;
  amountCents?: number;
  subscriptionId?: string;
}
export interface Billing {
  readonly mode: "stripe" | "dev";
  createCheckout(i: CheckoutInput): Promise<{ id: string; url: string; subscriptionId?: string }>;
  parseWebhook(rawBody: string, signature: string | null): Promise<BillingEvent>;
}

const DESCRIPTION = "Supply-chain documentation and analysis. Not legal advice or government certification.";

export class StripeBilling implements Billing {
  readonly mode = "stripe" as const;
  private readonly stripe: Stripe;
  constructor(secretKey: string, private readonly webhookSecret: string | undefined, stripe?: Stripe) {
    this.stripe = stripe ?? new Stripe(secretKey);
  }
  async createCheckout(i: CheckoutInput) {
    const metadata = { kind: i.kind, refId: i.refId, ...(i.kind === "pack" ? { packId: i.refId } : {}) };
    const s = await this.stripe.checkout.sessions.create({
      mode: i.monthly ? "subscription" : "payment",
      customer_email: i.customerEmail,
      client_reference_id: i.refId,
      metadata,
      ...(i.monthly ? { subscription_data: { metadata } } : {}),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: i.priceCents,
            product_data: { name: i.productName, description: DESCRIPTION },
            ...(i.monthly ? { recurring: { interval: "month" as const } } : {}),
          },
        },
      ],
      success_url: i.successUrl,
      cancel_url: i.cancelUrl,
    });
    if (!s.url) throw new DomainError("unavailable", "CHECKOUT_FAILED", "Could not start checkout.");
    return { id: s.id, url: s.url };
  }
  async parseWebhook(rawBody: string, signature: string | null): Promise<BillingEvent> {
    if (!this.webhookSecret) throw new DomainError("unavailable", "WEBHOOK_NOT_CONFIGURED", "STRIPE_WEBHOOK_SECRET is not set.");
    if (!signature) throw new DomainError("authentication", "WEBHOOK_SIGNATURE_MISSING", "Missing signature.");
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch {
      throw new DomainError("authentication", "WEBHOOK_SIGNATURE_INVALID", "Invalid signature.");
    }
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.payment_status !== "paid") return { id: event.id, type: "ignored" };
      return {
        id: event.id,
        type: "checkout.completed",
        ...sessionRef(s.metadata, s.client_reference_id),
        checkoutId: s.id,
        amountCents: s.amount_total ?? undefined,
        subscriptionId: typeof s.subscription === "string" ? s.subscription : s.subscription?.id,
      };
    }
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      return { id: event.id, type: "subscription.ended", subscriptionId: sub.id, kind: "refresh", refId: sub.metadata?.refId };
    }
    return { id: event.id, type: "ignored" };
  }
}

/** Reads { kind, refId } from session metadata; sessions from before this change only had packId. */
export function sessionRef(metadata: Stripe.Metadata | null | undefined, clientRef: string | null | undefined): Pick<BillingEvent, "kind" | "refId" | "packId"> {
  const kind = metadata?.kind;
  if (kind === "pack" || kind === "verification" || kind === "refresh") {
    const refId = metadata?.refId ?? clientRef ?? undefined;
    return { kind, refId, ...(kind === "pack" ? { packId: refId } : {}) };
  }
  const packId = metadata?.packId ?? clientRef ?? undefined;
  return { kind: "pack", refId: packId, packId };
}

export class DevBilling implements Billing {
  readonly mode = "dev" as const;
  async createCheckout(i: CheckoutInput) {
    return { id: `dev_${i.kind}_${i.refId}`, url: i.successUrl, ...(i.monthly ? { subscriptionId: `dev_sub_${i.refId}` } : {}) };
  }
  async parseWebhook(): Promise<BillingEvent> {
    throw new DomainError("unavailable", "WEBHOOK_NOT_CONFIGURED", "Stripe is not configured.");
  }
}

export function billingFromEnv(env: NodeJS.ProcessEnv = process.env): Billing {
  if (env.STRIPE_SECRET_KEY) return new StripeBilling(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
  if (env.NODE_ENV === "production" && env.ALLOW_DEV_ADAPTERS !== "true") throw new Error("STRIPE_SECRET_KEY is required in production");
  return new DevBilling();
}
