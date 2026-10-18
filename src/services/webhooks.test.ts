import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { StripeBilling, sessionRef } from "@/infra/billing";
import { normalizeEmailEvent, signSvix, verifyBasicAuth, verifySvix } from "./email-webhook";

const WHSEC = "whsec_test_secret";

describe("Stripe webhook signature", () => {
  const stripe = new Stripe("sk_test_dummy");
  const billing = new StripeBilling("sk_test_dummy", WHSEC, stripe);
  const payload = JSON.stringify({
    id: "evt_1", object: "event", type: "checkout.session.completed", api_version: "2024-06-20", created: 1, livemode: false, pending_webhooks: 0, request: null,
    data: { object: { id: "cs_1", object: "checkout.session", payment_status: "paid", amount_total: 250000, metadata: { packId: "pack-1" }, client_reference_id: "pack-1" } },
  });

  it("accepts a correctly signed checkout.session.completed", async () => {
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
    // An older pack session (metadata.packId only) still resolves to a pack payment.
    expect(await billing.parseWebhook(payload, sig)).toEqual({ id: "evt_1", type: "checkout.completed", kind: "pack", refId: "pack-1", packId: "pack-1", checkoutId: "cs_1", amountCents: 250000, subscriptionId: undefined });
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

describe("Stripe webhook: what was bought", () => {
  const stripe = new Stripe("sk_test_dummy");
  const billing = new StripeBilling("sk_test_dummy", WHSEC, stripe);
  const event = (type: string, object: Record<string, unknown>) =>
    JSON.stringify({ id: "evt_k", object: "event", type, api_version: "2024-06-20", created: 1, livemode: false, pending_webhooks: 0, request: null, data: { object } });
  const parse = (p: string) => billing.parseWebhook(p, stripe.webhooks.generateTestHeaderString({ payload: p, secret: WHSEC }));

  it("routes a supplier verification payment by metadata.kind", async () => {
    const p = event("checkout.session.completed", { id: "cs_v", object: "checkout.session", payment_status: "paid", amount_total: 150000, metadata: { kind: "verification", refId: "ver-1" }, client_reference_id: "ver-1" });
    expect(await parse(p)).toMatchObject({ type: "checkout.completed", kind: "verification", refId: "ver-1", checkoutId: "cs_v", amountCents: 150000 });
  });
  it("routes a refresh subscription and keeps its subscription id", async () => {
    const p = event("checkout.session.completed", { id: "cs_r", object: "checkout.session", mode: "subscription", payment_status: "paid", amount_total: 25000, subscription: "sub_1", metadata: { kind: "refresh", refId: "ref-1" } });
    expect(await parse(p)).toMatchObject({ type: "checkout.completed", kind: "refresh", refId: "ref-1", subscriptionId: "sub_1" });
  });
  it("reports a cancelled refresh subscription", async () => {
    const p = event("customer.subscription.deleted", { id: "sub_1", object: "subscription", metadata: { kind: "refresh", refId: "ref-1" } });
    expect(await parse(p)).toMatchObject({ type: "subscription.ended", subscriptionId: "sub_1", refId: "ref-1" });
  });
  it("reads old and new session metadata", () => {
    expect(sessionRef({ packId: "p1" }, null)).toEqual({ kind: "pack", refId: "p1", packId: "p1" });
    expect(sessionRef({ kind: "pack", refId: "p2" }, null)).toEqual({ kind: "pack", refId: "p2", packId: "p2" });
    expect(sessionRef({ kind: "verification", refId: "v1" }, null)).toEqual({ kind: "verification", refId: "v1" });
    expect(sessionRef({}, "p3")).toEqual({ kind: "pack", refId: "p3", packId: "p3" });
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
