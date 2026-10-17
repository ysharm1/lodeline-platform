/**
 * Marketing-site leads (lodeline.org contact form + checklist download).
 * Stored in Postgres, then the team is notified through the configured
 * EmailSender (LEADS_NOTIFY_EMAIL, default info@lodeline.org). A failed
 * notification never loses the lead: it stays in the table with notifiedAt=null.
 * The audit log records ids and kinds only, never contact details.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { ValidationError } from "@/domain/errors";
import type { AuthContext } from "@/domain/types";
import { requireAdmin } from "./authorization";
import { nowOf, type PlatformDeps } from "./deps";

import { EMAIL_RE, SUPPLIES_OPTIONS } from "./lead-rules";
export { EMAIL_RE, SUPPLIES_OPTIONS };

const trimmed = (max: number) => z.string().trim().max(max);
const optional = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), trimmed(max).optional());
const email = z.string().trim().max(200).regex(EMAIL_RE, "Please enter a valid work email.");

export const callLeadSchema = z.object({
  kind: z.literal("readiness_call"),
  name: trimmed(100).min(1, "Please fill in your name and company."),
  company: trimmed(200).min(1, "Please fill in your name and company."),
  email,
  phone: optional(40),
  supplies: z.enum(SUPPLIES_OPTIONS, { message: "Please select what you supply." }),
  message: optional(1500),
  sourcePath: optional(200),
});
export const checklistLeadSchema = z.object({
  kind: z.literal("checklist"),
  company: trimmed(200).min(1, "Please enter your company."),
  email,
  sourcePath: optional(200),
});
export const leadSchema = z.discriminatedUnion("kind", [callLeadSchema, checklistLeadSchema]);
export type LeadInput = z.infer<typeof leadSchema>;

export function hashIp(ip: string | null | undefined, salt = process.env.SESSION_SECRET ?? "lodeline"): string | null {
  if (!ip || ip === "unknown") return null;
  return createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32);
}

export function parseLead(raw: unknown): LeadInput {
  const r = leadSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue?.path[0];
    throw new ValidationError("LEAD_INVALID", issue?.message ?? "Please check the form.", typeof field === "string" ? field : undefined);
  }
  return r.data;
}

export function leadNotification(lead: LeadInput & { id: string }) {
  if (lead.kind === "checklist") {
    return {
      subject: `Lodeline checklist request: ${lead.company}`,
      text: [`Checklist download requested.`, ``, `Company: ${lead.company}`, `Email: ${lead.email}`, `Page: ${lead.sourcePath ?? "/"}`, `Lead id: ${lead.id}`].join("\n"),
    };
  }
  return {
    subject: `Lodeline inquiry: ${lead.company || lead.name}`,
    text: [
      `Readiness call requested.`,
      ``,
      `Name: ${lead.name}`,
      `Company: ${lead.company}`,
      `Email: ${lead.email}`,
      `Phone: ${lead.phone ?? "-"}`,
      `Supplies: ${lead.supplies}`,
      ``,
      `Message:`,
      lead.message ?? "-",
      ``,
      `Page: ${lead.sourcePath ?? "/"}`,
      `Lead id: ${lead.id}`,
    ].join("\n"),
  };
}

export class LeadService {
  constructor(
    private readonly d: PlatformDeps,
    private readonly notifyTo: string = process.env.LEADS_NOTIFY_EMAIL || "info@lodeline.org"
  ) {}

  async submit(raw: unknown, meta: { ip?: string | null } = {}) {
    const input = parseLead(raw);
    const row = await this.d.db.lead.create({
      data: {
        kind: input.kind,
        name: input.kind === "readiness_call" ? input.name : null,
        company: input.company,
        email: input.email.toLowerCase(),
        phone: input.kind === "readiness_call" ? input.phone ?? null : null,
        supplies: input.kind === "readiness_call" ? input.supplies : null,
        message: input.kind === "readiness_call" ? input.message ?? null : null,
        sourcePath: input.sourcePath ?? null,
        ipHash: hashIp(meta.ip),
      },
    });
    await this.d.audit.append({ action: "lead.created", subjectId: row.id, payload: { kind: row.kind }, ip: meta.ip ?? null });
    let notified = false;
    try {
      const msg = leadNotification({ ...input, id: row.id });
      await this.d.email.send({ to: this.notifyTo, subject: msg.subject, text: msg.text });
      await this.d.db.lead.update({ where: { id: row.id }, data: { notifiedAt: nowOf(this.d) } });
      notified = true;
    } catch (e) {
      console.error(JSON.stringify({ event: "lead.notify_failed", leadId: row.id, error: (e as Error).message }));
      await this.d.audit.append({ action: "lead.notify_failed", subjectId: row.id, payload: { kind: row.kind } });
    }
    return { id: row.id, kind: row.kind, notified };
  }

  async list(ctx: AuthContext, limit = 200) {
    requireAdmin(ctx);
    return this.d.db.lead.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  }

  async setStatus(ctx: AuthContext, id: string, status: unknown) {
    const admin = requireAdmin(ctx);
    if (status !== "new" && status !== "contacted" && status !== "closed") throw new ValidationError("LEAD_STATUS_INVALID", "Unknown status.");
    const row = await this.d.db.lead.update({ where: { id }, data: { status } });
    await this.d.audit.append({ action: "lead.status_changed", actorUserId: admin.userId, subjectId: id, payload: { status } });
    return row;
  }
}
