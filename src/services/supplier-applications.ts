/**
 * "For suppliers": an application to be listed in the directory as a
 * documented source. Public form -> pending application (admin queue) ->
 * admin approves -> an UNPUBLISHED, UNVERIFIED SupplierListing is created.
 * The listing only becomes "verified" through DirectoryService.verify, which
 * requires accepted evidence documents; an application never verifies itself.
 */
import { listingPosition } from "./geocoder";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors";
import { MATERIALS, STAGES, type AuthContext } from "@/domain/types";
import { requireAdmin } from "./authorization";
import { toIso2 } from "./countries";
import { nowOf, type PlatformDeps } from "./deps";
import { EMAIL_RE, hashIp } from "./leads";

const opt = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());
const list = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (typeof v === "string" ? [v] : v ?? []), z.array(z.enum(values)).max(values.length));

export const applicationSchema = z.object({
  companyName: z.string().trim().min(1, "Please enter your company name.").max(200),
  contactName: z.string().trim().min(1, "Please enter a contact name.").max(100),
  email: z.string().trim().max(200).regex(EMAIL_RE, "Please enter a valid work email."),
  phone: opt(40),
  website: opt(300).refine((v) => !v || /^https?:\/\/[^\s]+$/i.test(v), "Website must start with http:// or https://"),
  city: opt(120),
  country: opt(80),
  stages: list(STAGES).refine((a) => a.length > 0, "Select at least one production stage."),
  materials: list(MATERIALS).refine((a) => a.length > 0, "Select at least one material."),
  summary: z.string().trim().min(20, "Describe what you produce (at least 20 characters).").max(2000),
  documentsNote: opt(2000),
});

export function parseApplication(raw: unknown) {
  const r = applicationSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue?.path[0];
    throw new ValidationError("APPLICATION_INVALID", issue?.message ?? "Please check the form.", typeof field === "string" ? field : undefined);
  }
  const countryIso = r.data.country ? toIso2(r.data.country) : null;
  if (r.data.country && !countryIso) throw new ValidationError("COUNTRY_UNKNOWN", "Enter the country name or its 2-letter code.", "country");
  return { ...r.data, countryIso };
}

export class SupplierApplicationService {
  constructor(
    private readonly d: PlatformDeps,
    private readonly notifyTo: string = process.env.LEADS_NOTIFY_EMAIL || "info@lodeline.org"
  ) {}

  async submit(raw: unknown, meta: { ip?: string | null } = {}) {
    const a = parseApplication(raw);
    const row = await this.d.db.supplierApplication.create({
      data: {
        companyName: a.companyName,
        contactName: a.contactName,
        email: a.email.toLowerCase(),
        phone: a.phone ?? null,
        website: a.website ?? null,
        city: a.city ?? null,
        countryIso: a.countryIso,
        stages: a.stages,
        materials: a.materials,
        summary: a.summary,
        documentsNote: a.documentsNote ?? null,
        ipHash: hashIp(meta.ip),
      },
    });
    await this.d.audit.append({ action: "supplier_application.submitted", subjectId: row.id, ip: meta.ip ?? null });
    try {
      await this.d.email.send({
        to: this.notifyTo,
        subject: `Lodeline supplier application: ${row.companyName}`,
        text: [
          `New supplier listing application (pending review).`,
          ``,
          `Company: ${row.companyName}`,
          `Contact: ${row.contactName} <${row.email}>`,
          `Country: ${row.countryIso ?? "-"}`,
          `Stages: ${row.stages.join(", ")}`,
          `Materials: ${row.materials.join(", ")}`,
          ``,
          `Review: ${this.d.baseUrl}/admin/applications`,
        ].join("\n"),
      });
    } catch (e) {
      console.error(JSON.stringify({ event: "supplier_application.notify_failed", id: row.id, error: (e as Error).message }));
    }
    return { id: row.id, status: row.status };
  }

  async list(ctx: AuthContext, status?: "pending" | "approved" | "rejected") {
    requireAdmin(ctx);
    return this.d.db.supplierApplication.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 200 });
  }

  async approve(ctx: AuthContext, id: string, note?: unknown) {
    const admin = requireAdmin(ctx);
    const reviewNote = typeof note === "string" ? note.trim().slice(0, 1000) || null : null;
    // Map position is looked up before the transaction (the geocoder may call out).
    const pre = await this.d.db.supplierApplication.findUnique({ where: { id }, select: { city: true, countryIso: true } });
    const pos = pre ? await listingPosition(this.d.geocoder, pre.city, pre.countryIso) : {};
    const result = await this.d.db.$transaction(async (tx) => {
      const app = await tx.supplierApplication.findUnique({ where: { id } });
      if (!app) throw new NotFoundError("APPLICATION_NOT_FOUND", "Application not found.");
      if (app.status !== "pending") throw new ConflictError("APPLICATION_DECIDED", `Application is already ${app.status}.`);
      const listing = await tx.supplierListing.create({
        data: {
          name: app.companyName,
          summary: app.summary,
          website: app.website,
          city: app.city,
          countryIso: app.countryIso,
          countries: app.countryIso ? [app.countryIso] : [],
          stages: app.stages,
          materials: app.materials,
          published: false, // pending verification
          isExample: false,
          ...pos,
        },
      });
      const updated = await tx.supplierApplication.update({
        where: { id },
        data: { status: "approved", listingId: listing.id, reviewedById: admin.userId, reviewedAt: nowOf(this.d), reviewNote },
      });
      return { application: updated, listing };
    });
    await this.d.audit.append({ action: "supplier_application.approved", actorUserId: admin.userId, subjectId: id, payload: { listingId: result.listing.id } });
    await this.d.audit.append({ action: "listing.created", actorUserId: admin.userId, subjectId: result.listing.id, payload: { fromApplication: id } });
    return result;
  }

  async reject(ctx: AuthContext, id: string, note?: unknown) {
    const admin = requireAdmin(ctx);
    const app = await this.d.db.supplierApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundError("APPLICATION_NOT_FOUND", "Application not found.");
    if (app.status !== "pending") throw new ConflictError("APPLICATION_DECIDED", `Application is already ${app.status}.`);
    const row = await this.d.db.supplierApplication.update({
      where: { id },
      data: { status: "rejected", reviewedById: admin.userId, reviewedAt: nowOf(this.d), reviewNote: typeof note === "string" ? note.trim().slice(0, 1000) || null : null },
    });
    await this.d.audit.append({ action: "supplier_application.rejected", actorUserId: admin.userId, subjectId: id });
    return row;
  }
}
