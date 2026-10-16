/**
 * Billing port. StripeBilling uses Checkout (test-mode keys in non-prod).
 * DevBilling (no STRIPE_SECRET_KEY, non-production only) marks packs paid
 * immediately so the flow can be exercised locally.
 */
import Stripe from "stripe";
import { DomainError } from "@/domain/errors";

export const PACK_PRICE_MIN_CENTS = 200_000;
export const PACK_PRICE_MAX_CENTS = 500_000;

/** PACK_PRICE_CENTS, clamped to the approved $2,000–$5,000 band. Default $2,500. */
export function packPriceCents(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PACK_PRICE_CENTS ?? 250_000);
  if (!Number.isInteger(raw) || raw < PACK_PRICE_MIN_CENTS || raw > PACK_PRICE_MAX_CENTS) {
    throw new Error(`PACK_PRICE_CENTS must be an integer between ${PACK_PRICE_MIN_CENTS} and ${PACK_PRICE_MAX_CENTS}`);
  }
  return raw;
}

export interface CheckoutInput {
  packId: string;
  priceCents: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}
export interface BillingEvent {
  id: string;
  type: "checkout.completed" | "ignored";
  packId?: string;
  checkoutId?: string;
  amountCents?: number;
}
export interface Billing {
  readonly mode: "stripe" | "dev";
  createCheckout(i: CheckoutInput): Promise<{ id: string; url: string }>;
  parseWebhook(rawBody: string, signature: string | null): Promise<BillingEvent>;
}

export class StripeBilling implements Billing {
  readonly mode = "stripe" as const;
  private readonly stripe: Stripe;
  constructor(secretKey: string, private readonly webhookSecret: string | undefined, private readonly priceId?: string, stripe?: Stripe) {
    this.stripe = stripe ?? new Stripe(secretKey);
  }
  async createCheckout(i: CheckoutInput) {
    const s = await this.stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: i.customerEmail,
      client_reference_id: i.packId,
      metadata: { packId: i.packId },
      line_items: [
        this.priceId
          ? { price: this.priceId, quantity: 1 }
          : { quantity: 1, price_data: { currency: "usd", unit_amount: i.priceCents, product_data: { name: "Lodeline evidence pack (fixed fee)", description: "Supply-chain documentation and analysis. Not legal advice or government certification." } } },
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
      return { id: event.id, type: "checkout.completed", packId: s.metadata?.packId ?? s.client_reference_id ?? undefined, checkoutId: s.id, amountCents: s.amount_total ?? undefined };
    }
    return { id: event.id, type: "ignored" };
  }
}

export class DevBilling implements Billing {
  readonly mode = "dev" as const;
  async createCheckout(i: CheckoutInput) {
    return { id: `dev_${i.packId}`, url: i.successUrl };
  }
  async parseWebhook(): Promise<BillingEvent> {
    throw new DomainError("unavailable", "WEBHOOK_NOT_CONFIGURED", "Stripe is not configured.");
  }
}

export function billingFromEnv(env: NodeJS.ProcessEnv = process.env): Billing {
  if (env.STRIPE_SECRET_KEY) return new StripeBilling(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET, env.STRIPE_PRICE_PACK_STANDARD || undefined);
  if (env.NODE_ENV === "production" && env.ALLOW_DEV_ADAPTERS !== "true") throw new Error("STRIPE_SECRET_KEY is required in production");
  return new DevBilling();
}
