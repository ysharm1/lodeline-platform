/**
 * Admin review of extracted claims. Accept / reject / edit. Edits re-run
 * geocoding + the deterministic covered-country flag. Every decision is audited.
 */
import type { Prisma } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/domain/errors";
import { STAGES, type AuthContext, type Stage } from "@/domain/types";
import { requireAdmin } from "./authorization";
import { flagCoveredCountry } from "./countries";
import { nowOf, type PlatformDeps } from "./deps";

export interface ClaimEdit {
  issuer?: string | null;
  issueDate?: string | null;
  stage?: string | null;
  facilityName?: string | null;
  address?: string | null;
  country?: string | null;
  partId?: string | null;
}

export class ReviewService {
  constructor(private readonly d: PlatformDeps) {}

  async queue(ctx: AuthContext) {
    requireAdmin(ctx);
    const claims = await this.d.db.evidenceClaim.findMany({
      where: { reviewStatus: "in_review" },
      orderBy: { document: { uploadedAt: "asc" } },
      take: 100,
      include: { document: { include: { request: { include: { supplier: true, pack: { include: { org: true } } } } } } },
    });
    const docsNeedingManual = await this.d.db.evidenceDocument.findMany({
      where: { status: "in_review", claims: { none: {} } },
      include: { request: { include: { supplier: true } } },
      take: 50,
    });
    return { claims, docsNeedingManual };
  }

  async claimWithPages(ctx: AuthContext, claimId: string) {
    requireAdmin(ctx);
    const claim = await this.d.db.evidenceClaim.findUnique({ where: { id: claimId }, include: { document: { include: { pages: { orderBy: { page: "asc" } }, request: { include: { supplier: true } } } } } });
    if (!claim) throw new NotFoundError("CLAIM_NOT_FOUND", "Claim not found.");
    return claim;
  }

  async decide(ctx: AuthContext, claimId: string, input: { action?: unknown; note?: unknown; edit?: ClaimEdit }) {
    const admin = requireAdmin(ctx);
    const claim = await this.d.db.evidenceClaim.findUnique({ where: { id: claimId }, include: { document: true } });
    if (!claim) throw new NotFoundError("CLAIM_NOT_FOUND", "Claim not found.");
    const action = input.action;
    if (action !== "accept" && action !== "reject" && action !== "edit") throw new ValidationError("ACTION_INVALID", "action must be accept, reject or edit.");
    const note = typeof input.note === "string" ? input.note.slice(0, 1000) : null;
    const data: Prisma.EvidenceClaimUpdateInput = { reviewerNote: note, reviewedById: admin.userId, reviewedAt: nowOf(this.d) };
    const before = { stage: claim.stage, country: claim.country, address: claim.address, reviewStatus: claim.reviewStatus };

    if (input.edit) {
      const e = input.edit;
      if (e.stage !== undefined && e.stage !== null && !(STAGES as readonly string[]).includes(e.stage)) throw new ValidationError("STAGE_INVALID", "Unknown stage.");
      const str = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim().slice(0, 500));
      Object.assign(data, {
        issuer: str(e.issuer),
        facilityName: str(e.facilityName),
        address: str(e.address),
        country: str(e.country),
        stage: e.stage === undefined ? undefined : (e.stage as Stage | null),
        issueDate: e.issueDate === undefined ? undefined : e.issueDate ? new Date(e.issueDate) : null,
        partId: e.partId === undefined ? undefined : e.partId,
      });
      const address = (data.address as string | null | undefined) ?? (e.address === undefined ? claim.address : null);
      const country = (data.country as string | null | undefined) ?? (e.country === undefined ? claim.country : null);
      const facility = (data.facilityName as string | null | undefined) ?? claim.facilityName;
      if (e.address !== undefined || e.country !== undefined || e.facilityName !== undefined) {
        const q = address ?? [facility, country].filter(Boolean).join(", ");
        const geo = q ? await this.d.geocoder.geocode(q).catch(() => null) : null;
        const flag = flagCoveredCountry(country, geo?.countryIso);
        Object.assign(data, { latitude: geo?.latitude ?? null, longitude: geo?.longitude ?? null, countryIso: flag.countryIso, coveredCountry: flag.covered, coveredReason: flag.reason, geocodeProvider: geo ? this.d.geocoder.provider : null });
      }
    }
    if (action === "accept") data.reviewStatus = "accepted";
    if (action === "reject") data.reviewStatus = "rejected";
    const updated = await this.d.db.evidenceClaim.update({ where: { id: claimId }, data });
    await this.d.audit.append({ action: "claim.reviewed", actorUserId: admin.userId, subjectId: claimId, payload: { action, before, after: { stage: updated.stage, country: updated.country, address: updated.address, reviewStatus: updated.reviewStatus, coveredCountry: updated.coveredCountry }, documentId: claim.documentId } });
    // A document is "accepted" once it has at least one accepted claim and nothing pending.
    const pending = await this.d.db.evidenceClaim.count({ where: { documentId: claim.documentId, reviewStatus: "in_review" } });
    if (pending === 0) {
      const anyAccepted = await this.d.db.evidenceClaim.count({ where: { documentId: claim.documentId, reviewStatus: "accepted" } });
      await this.d.db.evidenceDocument.update({ where: { id: claim.documentId }, data: { status: anyAccepted ? "accepted" : "rejected", rejectionReason: anyAccepted ? null : "no_accepted_claims" } });
    }
    return updated;
  }

  /** Manual claim entry for scans / docs with no extractable claims. Still requires a verbatim-free reviewer note. */
  async addManualClaim(ctx: AuthContext, documentId: string, edit: ClaimEdit & { page?: number; note?: string }) {
    const admin = requireAdmin(ctx);
    const doc = await this.d.db.evidenceDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundError("DOCUMENT_NOT_FOUND", "Document not found.");
    const claim = await this.d.db.evidenceClaim.create({
      data: { documentId, citations: [{ field: "manual", page: edit.page ?? 1, quote: "(entered by reviewer from page image)" }] as unknown as Prisma.InputJsonValue, reviewStatus: "in_review", reviewerNote: edit.note ?? null },
    });
    return this.decide(admin, claim.id, { action: "edit", edit, note: edit.note });
  }
}
