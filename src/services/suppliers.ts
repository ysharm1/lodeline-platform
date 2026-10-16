/**
 * Suppliers, tokenized evidence requests, outreach and reminders.
 * Token: 256-bit random, looked up by SHA-256, AES-GCM copy for reminders,
 * expiry SUPPLIER_TOKEN_TTL_DAYS (30), revocable. Reminders on day 3/7/14
 * after the initial email, stopped by an upload, a bounce, revocation or expiry.
 */
import type { SupplierRequest } from "@prisma/client";
import { AuthenticationError, ConflictError, NotFoundError, ValidationError } from "@/domain/errors";
import type { AuthContext, Material, Stage } from "@/domain/types";
import { decryptToken, encryptToken, generateToken, hashToken } from "@/infra/token-crypto";
import { normalizeEmail } from "./magic-link";
import { requiredStagesFor } from "./pack-matrix";
import { nowOf, type PlatformDeps } from "./deps";
import type { PackService } from "./packs";

export const REMINDER_DAYS = [3, 7, 14] as const;
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

export class SupplierService {
  constructor(private readonly d: PlatformDeps, private readonly packs: PackService) {}

  async addRequest(ctx: AuthContext, packId: string, input: { name?: unknown; contactEmail?: unknown; contactName?: unknown; country?: unknown; partIds?: unknown }) {
    const pack = await this.packs.assertAccess(ctx, packId);
    if (!pack.paidAt) throw new ConflictError("PACK_NOT_PAID", "Complete checkout before contacting suppliers.");
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
    if (!name) throw new ValidationError("SUPPLIER_NAME_REQUIRED", "Supplier name is required.", "name");
    const contactEmail = normalizeEmail(input.contactEmail);
    const partIds = Array.isArray(input.partIds) ? input.partIds.filter((x): x is string => typeof x === "string") : [];
    const parts = await this.d.db.auditPart.findMany({ where: { auditId: pack.auditId, id: { in: partIds } } });
    if (parts.length === 0) throw new ValidationError("PARTS_REQUIRED", "Select at least one part from this pack.", "partIds");
    const stages = [...new Set(parts.flatMap((p) => requiredStagesFor(p.materials as Material[])))] as Stage[];
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
    await this.packs.assertAccess(ctx, req.packId);
    if (req.revokedAt) return;
    await this.d.db.supplierRequest.update({ where: { id: requestId }, data: { revokedAt: nowOf(this.d), nextReminderAt: null } });
    await this.d.audit.append({ action: "supplier.request_revoked", actorUserId: ctx.userId, subjectId: requestId, payload: { packId: req.packId } });
  }

  /** Public token resolution. Unknown, revoked and expired tokens are all refused. */
  async resolveToken(token: unknown) {
    if (typeof token !== "string" || token.length < 20 || token.length > 200) throw new AuthenticationError("TOKEN_INVALID", "This link is invalid.");
    const req = await this.d.db.supplierRequest.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { supplier: true, pack: { include: { org: true, audit: { include: { parts: true } } } }, documents: { orderBy: { uploadedAt: "desc" } } },
    });
    if (!req) throw new AuthenticationError("TOKEN_INVALID", "This link is invalid.");
    const st = tokenState(req, nowOf(this.d));
    if (st === "revoked") throw new AuthenticationError("TOKEN_REVOKED", "This link has been withdrawn.");
    if (st === "expired") throw new AuthenticationError("TOKEN_EXPIRED", "This link has expired. Ask your customer for a new one.");
    const parts = req.pack.audit.parts.filter((p) => req.partIds.includes(p.id));
    return { request: req, parts, buyerName: req.pack.org.name };
  }

  private template(kind: "initial" | "reminder", supplierName: string, buyer: string, link: string, stages: string[], n: number) {
    const ask = stages.map((s) => `  - ${s.replace("_", "/")}: facility name, address and country`).join("\n");
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
    if (!req.supplier.contactEmail || !req.tokenCiphertext) return false;
    const now = nowOf(this.d);
    const link = `${this.d.baseUrl.replace(/\/$/, "")}/s/${decryptToken(req.tokenCiphertext)}`;
    const { subject, text } = this.template(kind, req.supplier.contactName ?? req.supplier.name, req.pack.org.name, link, req.stagesRequested, req.reminderCount + 1);
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
