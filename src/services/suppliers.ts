/**
 * Suppliers, tokenized evidence requests, outreach and reminders.
 * Token: 256-bit random, looked up by SHA-256, AES-GCM copy for reminders,
 * expiry SUPPLIER_TOKEN_TTL_DAYS (30), revocable. Reminders on day 3/7/14
 * after the initial email, stopped by an upload, a bounce, revocation or expiry.
 *
 * A request belongs to a buyer's evidence pack OR to a supplier-paid
 * verification (no buyer involved). Either way the supplier can give, and
 * later withdraw, consent for Lodeline to keep the reviewed documents on file
 * and reuse them for the supplier's other customers.
 */
import type { SupplierRequest } from "@prisma/client";
import { AuthenticationError, AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/domain/errors";
import type { AuthContext, Material, Stage } from "@/domain/types";
import { decryptToken, encryptToken, generateToken, hashToken } from "@/infra/token-crypto";
import { normalizeEmail } from "./magic-link";
import { stagesForPart } from "./pack-matrix";
import { nowOf, type PlatformDeps } from "./deps";
import type { PackService } from "./packs";
import { packTier } from "./pricing";

export const REMINDER_DAYS = [3, 7, 14] as const;
/** mine -> separation -> metal/alloy -> magnet -> component: at most 4 hops upstream. */
export const MAX_FORWARD_DEPTH = 4;
export const MAX_FORWARDS_PER_REQUEST = 10;

export interface StageProgress {
  stage: Stage;
  /** Documents the supplier uploaded for this stage (per-stage form), excluding failed placeholders. */
  documents: { id: string; status: string }[];
  /** Upstream suppliers this stage was forwarded to. */
  forwardedTo: { requestId: string; supplierName: string; outreachStatus: string; documents: number }[];
}

/** Per-stage status for the supplier portal. Pure. */
export function stageProgress(
  stages: Stage[],
  documents: { id: string; status: string; declaredStage: Stage | null }[],
  forwarded: { id: string; stagesRequested: Stage[]; outreachStatus: string; supplier: { name: string }; documents: { id: string; status: string }[] }[]
): StageProgress[] {
  return stages.map((stage) => ({
    stage,
    documents: documents.filter((d) => d.declaredStage === stage && d.status !== "requested").map((d) => ({ id: d.id, status: d.status })),
    forwardedTo: forwarded
      .filter((f) => f.stagesRequested.includes(stage))
      .map((f) => ({ requestId: f.id, supplierName: f.supplier.name, outreachStatus: f.outreachStatus, documents: f.documents.filter((d) => d.status !== "requested").length })),
  }));
}
const DAY = 86_400_000;

export function nextReminderAt(initialSentAt: Date, remindersSent: number): Date | null {
  const d = REMINDER_DAYS[remindersSent];
  return d === undefined ? null : new Date(initialSentAt.getTime() + d * DAY);
}

export type TokenState = "ok" | "expired" | "revoked";
export function tokenState(r: Pick<SupplierRequest, "tokenExpiresAt" | "revokedAt">, now: Date): TokenState {
  if (r.revokedAt) return "revoked";
  if (now >= r.tokenExpiresAt) return "expired";
  return "ok";
}

/** True while the supplier has given consent to reuse and has not withdrawn it. */
export function hasActiveReuseConsent(r: Pick<SupplierRequest, "reuseConsentAt" | "reuseConsentWithdrawnAt">): boolean {
  return !!r.reuseConsentAt && !r.reuseConsentWithdrawnAt;
}

/** Upstream stages a supplier verification asks about, from what the listing says it does. */
export function verificationStages(listingStages: Stage[]): Stage[] {
  const upstream: Stage[] = ["mine", "separation", "metal_alloy", "magnet"];
  const picked = upstream.filter((s) => listingStages.includes(s));
  return picked.length ? picked : upstream;
}

export class SupplierService {
  constructor(private readonly d: PlatformDeps, private readonly packs: PackService) {}

  async addRequest(ctx: AuthContext, packId: string, input: { name?: unknown; contactEmail?: unknown; contactName?: unknown; country?: unknown; partIds?: unknown }) {
    const pack = await this.packs.assertAccess(ctx, packId);
    if (!pack.paidAt) throw new ConflictError("PACK_NOT_PAID", "Complete checkout before contacting suppliers.");
    // Each tier covers a set number of suppliers (src/services/pricing.ts).
    // Requests a supplier forwarded upstream from the portal do not use the buyer's allowance.
    const tier = packTier(pack.tier);
    const limit = await this.packs.supplierLimit(pack);
    const active = await this.d.db.supplierRequest.count({ where: { packId, revokedAt: null, parentRequestId: null } });
    if (active >= limit) {
      throw new ConflictError("TIER_SUPPLIER_LIMIT", `The ${tier.label} pack covers up to ${limit} suppliers. Contact info@lodeline.org to extend the scope.`);
    }
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
    if (!name) throw new ValidationError("SUPPLIER_NAME_REQUIRED", "Supplier name is required.", "name");
    const contactEmail = normalizeEmail(input.contactEmail);
    const partIds = Array.isArray(input.partIds) ? input.partIds.filter((x): x is string => typeof x === "string") : [];
    const parts = await this.d.db.auditPart.findMany({ where: { auditId: pack.auditId, id: { in: partIds } } });
    if (parts.length === 0) throw new ValidationError("PARTS_REQUIRED", "Select at least one part from this pack.", "partIds");
    const stages = [...new Set(parts.flatMap((p) => stagesForPart({ materials: p.materials as Material[], coverage: p.coverage })))] as Stage[];
    if (stages.length === 0) throw new ValidationError("PARTS_NOT_IN_SCOPE", "None of the selected parts were flagged.", "partIds");

    const now = nowOf(this.d);
    const supplier = await this.d.db.supplier.create({
      data: { name, contactEmail, contactName: typeof input.contactName === "string" ? input.contactName.slice(0, 200) : null, country: typeof input.country === "string" ? input.country.slice(0, 100) : null },
    });
    const token = generateToken();
    const ttl = this.d.supplierTokenTtlDays ?? Number(process.env.SUPPLIER_TOKEN_TTL_DAYS ?? 30);
    const req = await this.d.db.supplierRequest.create({
      data: {
        packId,
        supplierId: supplier.id,
        partIds: parts.map((p) => p.id),
        stagesRequested: stages,
        tokenHash: hashToken(token),
        tokenCiphertext: encryptToken(token),
        tokenExpiresAt: new Date(now.getTime() + ttl * DAY),
        outreachStatus: "queued",
      },
    });
    await this.d.audit.append({ action: "supplier.request_created", actorUserId: ctx.userId, subjectId: req.id, payload: { packId, supplierId: supplier.id, partCount: parts.length, stages } });
    await this.sendOutreach(req.id, "initial");
    return { requestId: req.id, supplierId: supplier.id };
  }

  async revoke(ctx: AuthContext, requestId: string) {
    const req = await this.d.db.supplierRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundError("REQUEST_NOT_FOUND", "Request not found.");
    if (req.packId) await this.packs.assertAccess(ctx, req.packId);
    else if (ctx.role !== "admin") throw new AuthorizationError("ROLE_FORBIDDEN", "Only Lodeline can revoke a verification link.");
    if (req.revokedAt) return;
    await this.d.db.supplierRequest.update({ where: { id: requestId }, data: { revokedAt: nowOf(this.d), nextReminderAt: null } });
    await this.d.audit.append({ action: "supplier.request_revoked", actorUserId: ctx.userId, subjectId: requestId, payload: { packId: req.packId } });
  }

  /** Public token resolution. Unknown, revoked and expired tokens are all refused. */
  async resolveToken(token: unknown) {
    if (typeof token !== "string" || token.length < 20 || token.length > 200) throw new AuthenticationError("TOKEN_INVALID", "This link is invalid.");
    const req = await this.d.db.supplierRequest.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        supplier: true,
        pack: { include: { org: true, audit: { include: { parts: true } } } },
        verification: { include: { listing: true } },
        documents: { orderBy: { uploadedAt: "desc" } },
        parent: { include: { supplier: true } },
        forwarded: { where: { revokedAt: null }, include: { supplier: true, documents: { select: { id: true, status: true } } }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!req) throw new AuthenticationError("TOKEN_INVALID", "This link is invalid.");
    const st = tokenState(req, nowOf(this.d));
    if (st === "revoked") throw new AuthenticationError("TOKEN_REVOKED", "This link has been withdrawn.");
    if (st === "expired") throw new AuthenticationError("TOKEN_EXPIRED", "This link has expired. Ask your customer for a new one.");
    const parts = req.pack ? req.pack.audit.parts.filter((p) => req.partIds.includes(p.id)) : [];
    return {
      request: req,
      parts,
      /** Who is asking: the buyer's company, or Lodeline itself for a verification. */
      buyerName: req.pack ? req.pack.org.name : "Lodeline",
      purpose: (req.pack ? "pack" : "verification") as "pack" | "verification",
      reuseConsent: hasActiveReuseConsent(req),
      stages: stageProgress(req.stagesRequested as Stage[], req.documents, req.forwarded),
    };
  }

  /**
   * Forwarding up the chain: from the portal, a supplier hands one or more of
   * its requested stages to its own upstream supplier (e.g. a magnet maker
   * forwards "metal/alloy" to its alloy supplier). The upstream supplier gets
   * its own private link for the same parts and only those stages. Documents
   * it uploads go through the same checks and review queue and count toward
   * the same pack. Forwarded links do not use the buyer's supplier allowance.
   */
  async forward(token: unknown, input: { stages?: unknown; name?: unknown; contactEmail?: unknown; contactName?: unknown; country?: unknown }) {
    const { request } = await this.resolveToken(token);
    if (!request.packId) throw new ConflictError("FORWARD_NOT_AVAILABLE", "Verification requests cover your own documents and cannot be forwarded.");
    const stages = (Array.isArray(input.stages) ? input.stages : typeof input.stages === "string" ? [input.stages] : []).filter((x): x is Stage => typeof x === "string" && (request.stagesRequested as string[]).includes(x));
    if (stages.length === 0) throw new ValidationError("STAGES_REQUIRED", "Choose at least one of the requested stages to forward.", "stages");
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
    if (!name) throw new ValidationError("SUPPLIER_NAME_REQUIRED", "Your supplier's company name is required.", "name");
    const contactEmail = normalizeEmail(input.contactEmail);
    let depth = 0;
    for (let cur: string | null = request.parentRequestId; cur && depth < 10; depth++) {
      cur = (await this.d.db.supplierRequest.findUnique({ where: { id: cur }, select: { parentRequestId: true } }))?.parentRequestId ?? null;
    }
    if (depth >= MAX_FORWARD_DEPTH) throw new ConflictError("FORWARD_DEPTH", "This request has already been forwarded through several suppliers. Contact info@lodeline.org.");
    if (request.forwarded.length >= MAX_FORWARDS_PER_REQUEST) throw new ConflictError("FORWARD_LIMIT", "Too many forwards from this link. Contact info@lodeline.org.");
    const now = nowOf(this.d);
    const supplier = await this.d.db.supplier.create({
      data: { name, contactEmail, contactName: typeof input.contactName === "string" ? input.contactName.trim().slice(0, 200) || null : null, country: typeof input.country === "string" ? input.country.trim().slice(0, 100) || null : null },
    });
    const raw = generateToken();
    const ttl = this.d.supplierTokenTtlDays ?? Number(process.env.SUPPLIER_TOKEN_TTL_DAYS ?? 30);
    const child = await this.d.db.supplierRequest.create({
      data: {
        packId: request.packId,
        parentRequestId: request.id,
        supplierId: supplier.id,
        partIds: request.partIds,
        stagesRequested: stages,
        tokenHash: hashToken(raw),
        tokenCiphertext: encryptToken(raw),
        tokenExpiresAt: new Date(now.getTime() + ttl * DAY),
        outreachStatus: "queued",
      },
    });
    await this.d.audit.append({ action: "supplier.request_forwarded", actorSupplierRequestId: request.id, subjectId: child.id, payload: { parentRequestId: request.id, packId: request.packId, supplierId: supplier.id, stages } });
    const sent = await this.sendOutreach(child.id, "initial");
    return { requestId: child.id, supplierId: supplier.id, stages, emailed: sent };
  }

  /**
   * The supplier gives or withdraws consent for Lodeline to keep the reviewed
   * documents from this request and reuse them for the supplier's other
   * customers. Giving consent needs the name of the person agreeing.
   */
  async setReuseConsent(token: unknown, input: { consent?: unknown; name?: unknown }) {
    const { request } = await this.resolveToken(token);
    const now = nowOf(this.d);
    if (input.consent === true) {
      const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
      if (name.length < 2) throw new ValidationError("CONSENT_NAME_REQUIRED", "Type your name to give consent.", "name");
      await this.d.db.supplierRequest.update({ where: { id: request.id }, data: { reuseConsentAt: now, reuseConsentName: name, reuseConsentWithdrawnAt: null } });
      await this.d.audit.append({ action: "supplier.reuse_consent_given", actorSupplierRequestId: request.id, subjectId: request.id, payload: { purpose: request.packId ? "pack" : "verification" } });
      return { reuseConsent: true };
    }
    if (input.consent === false) {
      if (hasActiveReuseConsent(request)) {
        await this.d.db.supplierRequest.update({ where: { id: request.id }, data: { reuseConsentWithdrawnAt: now } });
        await this.d.audit.append({ action: "supplier.reuse_consent_withdrawn", actorSupplierRequestId: request.id, subjectId: request.id, payload: {} });
      }
      return { reuseConsent: false };
    }
    throw new ValidationError("CONSENT_REQUIRED", "consent must be true or false.");
  }

  /**
   * After a supplier pays for verification: create their upload link and email
   * it. No buyer and no parts are involved; the stages come from the listing.
   */
  async addVerificationRequest(verificationId: string) {
    const v = await this.d.db.supplierVerification.findUniqueOrThrow({ where: { id: verificationId }, include: { listing: true, requests: true } });
    if (v.requests.length) return { requestId: v.requests[0].id, created: false };
    const now = nowOf(this.d);
    const supplier = await this.d.db.supplier.create({ data: { name: v.listing.name, contactEmail: v.contactEmail, contactName: v.contactName, country: v.listing.countryIso } });
    const token = generateToken();
    // A verification gets 60 days to upload, double a buyer request, since there is no buyer deadline.
    const ttlDays = 60;
    const req = await this.d.db.supplierRequest.create({
      data: {
        verificationId: v.id,
        supplierId: supplier.id,
        partIds: [],
        stagesRequested: verificationStages(v.listing.stages as Stage[]),
        tokenHash: hashToken(token),
        tokenCiphertext: encryptToken(token),
        tokenExpiresAt: new Date(now.getTime() + ttlDays * DAY),
        outreachStatus: "queued",
      },
    });
    await this.d.audit.append({ action: "supplier.verification_request_created", subjectId: req.id, payload: { verificationId: v.id, listingId: v.listingId } });
    await this.sendOutreach(req.id, "initial");
    return { requestId: req.id, created: true };
  }

  private template(kind: "initial" | "reminder", supplierName: string, buyer: string, link: string, stages: string[], n: number, purpose: "pack" | "verification") {
    const ask = stages.map((s) => `  - ${s.replace("_", "/")}: facility name, address and country`).join("\n");
    if (purpose === "verification") {
      const subject = kind === "initial" ? "Your Lodeline verification: upload your origin documents" : `Reminder ${n}: upload your origin documents for Lodeline verification`;
      const text =
        `Hello ${supplierName},\n\nThank you for ordering a Lodeline supplier verification. Please upload certificates or declarations covering:\n${ask}\n\n` +
        `Upload link (no account needed, expires automatically):\n${link}\n\n` +
        `Your fee covers the review, whatever it finds. A Lodeline reviewer checks each document and records what it supports.\n\n` +
        `PDF certificates/declarations only. Please do NOT send drawings, controlled technical data or export-controlled information.\n\n` +
        `Lodeline provides supply-chain documentation and analysis, not legal advice or government certification.\nQuestions: info@lodeline.org\n`;
      return { subject, text };
    }
    const subject = kind === "initial" ? `${buyer} requests origin documents via Lodeline` : `Reminder ${n}: origin documents for ${buyer}`;
    const text =
      `Hello ${supplierName},\n\n${buyer} is compiling supply-chain origin records for parts you supply ` +
      `(DFARS 252.225-7052: magnets, tungsten, tantalum). Please upload certificates or declarations covering:\n${ask}\n\n` +
      `Upload link (no account needed, expires automatically):\n${link}\n\n` +
      `PDF certificates/declarations only. Please do NOT send drawings, controlled technical data or export-controlled information.\n\n` +
      `Lodeline provides supply-chain documentation and analysis, not legal advice or government certification.\nQuestions: info@lodeline.org\n`;
    return { subject, text };
  }

  async sendOutreach(requestId: string, kind: "initial" | "reminder"): Promise<boolean> {
    const req = await this.d.db.supplierRequest.findUniqueOrThrow({ where: { id: requestId }, include: { supplier: true, pack: { include: { org: true } } } });
    const purpose = req.pack ? "pack" : "verification";
    if (!req.supplier.contactEmail || !req.tokenCiphertext) return false;
    const now = nowOf(this.d);
    const link = `${this.d.baseUrl.replace(/\/$/, "")}/s/${decryptToken(req.tokenCiphertext)}`;
    const via = req.parentRequestId ? (await this.d.db.supplierRequest.findUnique({ where: { id: req.parentRequestId }, include: { supplier: true } }))?.supplier.name ?? null : null;
    const t = this.template(kind, req.supplier.contactName ?? req.supplier.name, req.pack?.org.name ?? "Lodeline", link, req.stagesRequested, req.reminderCount + 1, purpose);
    const subject = t.subject;
    const text = via ? t.text.replace(/^(Hello [^\n]*\n\n)/, `$1${via} forwarded this request to you because you supply them for the stages below.\n\n`) : t.text;
    try {
      const r = await this.d.email.send({ to: req.supplier.contactEmail, subject, text });
      await this.d.db.outreachEmail.create({ data: { requestId, kind, providerMessageId: r.providerMessageId, status: "sent", sentAt: now } });
      const initialSentAt = kind === "initial" ? now : ((await this.d.db.outreachEmail.findFirst({ where: { requestId, kind: "initial", status: "sent" }, orderBy: { sentAt: "asc" } }))?.sentAt ?? now);
      const reminderCount = kind === "reminder" ? req.reminderCount + 1 : req.reminderCount;
      await this.d.db.supplierRequest.update({
        where: { id: requestId },
        data: { outreachStatus: kind === "initial" ? "sent" : "reminded", lastEmailAt: now, reminderCount, nextReminderAt: nextReminderAt(initialSentAt, reminderCount) },
      });
      await this.d.audit.append({ action: "outreach.sent", subjectId: requestId, payload: { kind, provider: this.d.email.name, providerMessageId: r.providerMessageId } });
      return true;
    } catch (e) {
      await this.d.db.outreachEmail.create({ data: { requestId, kind, status: "failed", error: (e as Error).message.slice(0, 300) } });
      await this.d.audit.append({ action: "outreach.failed", subjectId: requestId, payload: { kind, provider: this.d.email.name } });
      return false;
    }
  }

  /** Cron entry point. Safe to run as often as you like: only due rows are touched. */
  async runReminders(limit = 200) {
    const now = nowOf(this.d);
    const due = await this.d.db.supplierRequest.findMany({
      where: { nextReminderAt: { lte: now }, revokedAt: null, tokenExpiresAt: { gt: now }, outreachStatus: { in: ["sent", "opened", "reminded"] }, reminderCount: { lt: REMINDER_DAYS.length } },
      take: limit,
      orderBy: { nextReminderAt: "asc" },
    });
    let sent = 0;
    for (const r of due) if (await this.sendOutreach(r.id, "reminder")) sent++;
    return { due: due.length, sent };
  }

  /** Called on first successful upload: stop reminders. */
  async markResponded(requestId: string) {
    await this.d.db.supplierRequest.update({ where: { id: requestId }, data: { outreachStatus: "responded", nextReminderAt: null } });
  }
}
