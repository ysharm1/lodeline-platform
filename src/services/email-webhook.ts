/**
 * Inbound email-provider events (opens, bounces, deliveries).
 *  - Resend: Svix signatures (svix-id, svix-timestamp, svix-signature: "v1,<b64 hmac>").
 *    Secret: EMAIL_WEBHOOK_SECRET ("whsec_..."). Timestamps older than 5 min are refused.
 *  - Postmark: HTTP Basic auth on the webhook URL; password = EMAIL_WEBHOOK_SECRET.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "@/domain/errors";
import type { PlatformDeps } from "./deps";

const eq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function signSvix(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  return "v1," + createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export function verifySvix(secret: string, headers: Headers, body: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sig = headers.get("svix-signature");
  if (!id || !ts || !sig) return false;
  if (Math.abs(nowSec - Number(ts)) > 300) return false;
  const expected = signSvix(secret, id, ts, body);
  return sig.split(" ").some((s) => eq(s, expected));
}

export function verifyBasicAuth(secret: string, headers: Headers): boolean {
  const h = headers.get("authorization") ?? "";
  if (!h.startsWith("Basic ")) return false;
  const [, pass = ""] = Buffer.from(h.slice(6), "base64").toString("utf8").split(":");
  return eq(pass, secret);
}

export interface NormalizedEmailEvent {
  id: string;
  messageId: string;
  kind: "opened" | "bounced" | "delivered" | "other";
}

export function normalizeEmailEvent(body: Record<string, unknown>, headers: Headers): NormalizedEmailEvent | null {
  if (typeof body.type === "string" && body.data && typeof body.data === "object") {
    const data = body.data as { email_id?: string };
    if (!data.email_id) return null;
    const kind = body.type === "email.opened" ? "opened" : body.type === "email.bounced" ? "bounced" : body.type === "email.delivered" ? "delivered" : "other";
    return { id: headers.get("svix-id") ?? `${body.type}:${data.email_id}`, messageId: data.email_id, kind };
  }
  if (typeof body.RecordType === "string" && typeof body.MessageID === "string") {
    const kind = body.RecordType === "Open" ? "opened" : body.RecordType === "Bounce" ? "bounced" : body.RecordType === "Delivery" ? "delivered" : "other";
    return { id: `postmark:${body.RecordType}:${body.MessageID}:${String(body.ID ?? body.ReceivedAt ?? "")}`, messageId: body.MessageID, kind };
  }
  return null;
}

export async function handleEmailWebhook(d: PlatformDeps, headers: Headers, rawBody: string, secret: string | undefined) {
  if (!secret) throw new DomainError("unavailable", "WEBHOOK_NOT_CONFIGURED", "EMAIL_WEBHOOK_SECRET is not set.");
  if (!verifySvix(secret, headers, rawBody) && !verifyBasicAuth(secret, headers)) throw new DomainError("authentication", "WEBHOOK_SIGNATURE_INVALID", "Invalid signature.");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new DomainError("validation", "WEBHOOK_BODY_INVALID", "Invalid JSON.");
  }
  const ev = normalizeEmailEvent(body, headers);
  if (!ev) return { handled: false };
  const seen = await d.db.webhookEvent.findUnique({ where: { id: ev.id } });
  if (seen) return { handled: false, duplicate: true };
  await d.db.webhookEvent.create({ data: { id: ev.id, source: "email" } });
  const email = await d.db.outreachEmail.findFirst({ where: { providerMessageId: ev.messageId } });
  if (!email) return { handled: false };
  await d.db.outreachEmail.update({ where: { id: email.id }, data: { status: ev.kind } });
  const req = await d.db.supplierRequest.findUnique({ where: { id: email.requestId } });
  if (req && req.outreachStatus !== "responded") {
    if (ev.kind === "bounced") await d.db.supplierRequest.update({ where: { id: req.id }, data: { outreachStatus: "bounced", nextReminderAt: null } });
    if (ev.kind === "opened" && (req.outreachStatus === "sent" || req.outreachStatus === "reminded")) await d.db.supplierRequest.update({ where: { id: req.id }, data: { outreachStatus: "opened" } });
  }
  await d.audit.append({ action: "outreach.event", subjectId: email.requestId, payload: { kind: ev.kind, providerMessageId: ev.messageId } });
  return { handled: true, kind: ev.kind };
}
