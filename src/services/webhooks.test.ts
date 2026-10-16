import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { StripeBilling, packPriceCents } from "@/infra/billing";
import { normalizeEmailEvent, signSvix, verifyBasicAuth, verifySvix } from "./email-webhook";

const WHSEC = "whsec_test_secret";

describe("Stripe webhook signature", () => {
  const stripe = new Stripe("sk_test_dummy");
  const billing = new StripeBilling("sk_test_dummy", WHSEC, undefined, stripe);
  const payload = JSON.stringify({
    id: "evt_1", object: "event", type: "checkout.session.completed", api_version: "2024-06-20", created: 1, livemode: false, pending_webhooks: 0, request: null,
    data: { object: { id: "cs_1", object: "checkout.session", payment_status: "paid", amount_total: 250000, metadata: { packId: "pack-1" }, client_reference_id: "pack-1" } },
  });

  it("accepts a correctly signed checkout.session.completed", async () => {
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
    expect(await billing.parseWebhook(payload, sig)).toEqual({ id: "evt_1", type: "checkout.completed", packId: "pack-1", checkoutId: "cs_1", amountCents: 250000 });
  });
  it("rejects a bad signature, a tampered body and a missing header", async () => {
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_other" });
    await expect(billing.parseWebhook(payload, sig)).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_INVALID" });
    const good = stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
    await expect(billing.parseWebhook(payload.replace("250000", "1"), good)).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_INVALID" });
    await expect(billing.parseWebhook(payload, null)).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_MISSING" });
  });
  it("ignores unpaid sessions", async () => {
    const p = payload.replace('"paid"', '"unpaid"');
    expect((await billing.parseWebhook(p, stripe.webhooks.generateTestHeaderString({ payload: p, secret: WHSEC }))).type).toBe("ignored");
  });
});

describe("pack price band", () => {
  it("defaults to $2,500 and enforces $2k–$5k", () => {
    expect(packPriceCents({} as NodeJS.ProcessEnv)).toBe(250000);
    expect(packPriceCents({ PACK_PRICE_CENTS: "500000" } as unknown as NodeJS.ProcessEnv)).toBe(500000);
    expect(() => packPriceCents({ PACK_PRICE_CENTS: "199999" } as unknown as NodeJS.ProcessEnv)).toThrow();
    expect(() => packPriceCents({ PACK_PRICE_CENTS: "600000" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
});

describe("email webhook signatures", () => {
  const secret = "whsec_" + Buffer.from("resend-secret").toString("base64");
  const body = JSON.stringify({ type: "email.bounced", data: { email_id: "msg_1" } });
  it("verifies Svix (Resend) signatures with a 5-minute window", () => {
    const now = 1_800_000_000;
    const h = new Headers({ "svix-id": "msg_abc", "svix-timestamp": String(now), "svix-signature": signSvix(secret, "msg_abc", String(now), body) });
    expect(verifySvix(secret, h, body, now)).toBe(true);
    expect(verifySvix(secret, h, body + " ", now)).toBe(false);
    expect(verifySvix(secret, h, body, now + 301)).toBe(false);
    expect(verifySvix("whsec_" + Buffer.from("other").toString("base64"), h, body, now)).toBe(false);
  });
  it("verifies Postmark basic auth", () => {
    const ok = new Headers({ authorization: "Basic " + Buffer.from("postmark:s3cret").toString("base64") });
    expect(verifyBasicAuth("s3cret", ok)).toBe(true);
    expect(verifyBasicAuth("nope", ok)).toBe(false);
    expect(verifyBasicAuth("s3cret", new Headers())).toBe(false);
  });
  it("normalizes Resend and Postmark events", () => {
    expect(normalizeEmailEvent(JSON.parse(body), new Headers({ "svix-id": "e1" }))).toEqual({ id: "e1", messageId: "msg_1", kind: "bounced" });
    expect(normalizeEmailEvent({ RecordType: "Open", MessageID: "pm-1", ReceivedAt: "t" }, new Headers())).toMatchObject({ messageId: "pm-1", kind: "opened" });
    expect(normalizeEmailEvent({ hello: 1 }, new Headers())).toBeNull();
  });
});
