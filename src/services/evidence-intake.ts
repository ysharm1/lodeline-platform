/**
 * Supplier evidence intake:
 *  1. createUpload: preflight (PDF only, <=20 MB, no CAD), presigned PUT direct to storage.
 *  2. completeUpload: fetch bytes, magic-byte check, SHA-256, per-page text,
 *     drawing / export-control rejection, LLM (or mock) claim extraction,
 *     verbatim-citation filter, geocode, covered-country flag. Every claim
 *     lands as `in_review`; nothing reaches a pack until an admin accepts it.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { DomainError, NotFoundError, ValidationError } from "@/domain/errors";
import { extractPdfPages } from "@/infra/pdf-text";
import { verifyClaims } from "./claim-verify";
import { flagCoveredCountry } from "./countries";
import { detectDrawingFromText, preflightEvidenceFile } from "./drawing-detect";
import { nowOf, type PlatformDeps } from "./deps";
import type { SupplierService } from "./suppliers";

export type PageExtractor = (bytes: Uint8Array) => Promise<string[]>;

export class EvidenceIntakeService {
  constructor(private readonly d: PlatformDeps, private readonly suppliers: SupplierService, private readonly extractPages: PageExtractor = extractPdfPages) {}

  async createUpload(token: unknown, input: { fileName?: unknown; sizeBytes?: unknown }) {
    const { request } = await this.suppliers.resolveToken(token);
    const fileName = typeof input.fileName === "string" ? input.fileName.replace(/[^\w.\- ()]/g, "_").slice(0, 200) : "";
    const size = Number(input.sizeBytes);
    if (!fileName || !Number.isInteger(size) || size <= 0) throw new ValidationError("FILE_REQUIRED", "Choose a PDF to upload.", "file");
    const pre = preflightEvidenceFile(fileName, size);
    if (!pre.ok) throw new DomainError(pre.reason === "too_large" ? "payload_too_large" : "unsupported", pre.reason === "cad_file" ? "DRAWING_REJECTED" : "FILE_TYPE_UNSUPPORTED", pre.detail, "file");
    const id = randomUUID();
    const key = `evidence/${request.packId ?? `verification-${request.verificationId}`}/${request.id}/${id}.pdf`;
    await this.d.db.evidenceDocument.create({ data: { id, requestId: request.id, fileKey: key, fileName, mime: "application/pdf", sha256: "", sizeBytes: size, status: "requested" } });
    const put = await this.d.storage.presignPut(key, "application/pdf", size, 600);
    return { documentId: id, upload: put };
  }

  async completeUpload(token: unknown, documentId: unknown) {
    const { request } = await this.suppliers.resolveToken(token);
    if (typeof documentId !== "string") throw new ValidationError("DOCUMENT_REQUIRED", "documentId is required.");
    const doc = await this.d.db.evidenceDocument.findFirst({ where: { id: documentId, requestId: request.id } });
    if (!doc) throw new NotFoundError("DOCUMENT_NOT_FOUND", "Upload not found.");
    if (doc.status !== "requested") return { documentId: doc.id, status: doc.status, rejectionReason: doc.rejectionReason, claims: await this.d.db.evidenceClaim.count({ where: { documentId: doc.id } }) };

    const bytes = await this.d.storage.get(doc.fileKey);
    if (!bytes) throw new ValidationError("UPLOAD_MISSING", "The file did not arrive. Please upload again.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const reject = async (reason: string, detail: string) => {
      await this.d.db.evidenceDocument.update({ where: { id: doc.id }, data: { status: "rejected", rejectionReason: reason, sha256, sizeBytes: bytes.byteLength } });
      await this.d.audit.append({ action: "supplier.document_rejected", actorSupplierRequestId: request.id, subjectId: doc.id, payload: { reason, sha256 } });
      return { documentId: doc.id, status: "rejected" as const, rejectionReason: reason, detail, claims: 0 };
    };

    const pre = preflightEvidenceFile(doc.fileName, bytes.byteLength, bytes.subarray(0, 8));
    if (!pre.ok) return reject(pre.reason, pre.detail);
    let pages: string[];
    try {
      pages = await this.extractPages(bytes);
    } catch {
      return reject("unreadable_pdf", "The PDF could not be read.");
    }
    const verdict = detectDrawingFromText(pages);
    if (!verdict.ok) return reject(verdict.reason, verdict.detail);

    await this.d.db.documentPage.createMany({ data: pages.map((text, i) => ({ documentId: doc.id, page: i + 1, text: text.slice(0, 50_000) })) });
    let created = 0;
    let model = "none";
    if (!verdict.needsManualReview) {
      const extracted = await this.d.llm.extractClaims(pages).catch((e) => {
        if ((e as { code?: string }).code === "LLM_ZDR_NOT_CONFIRMED") return null; // admin enters claims manually
        throw e;
      });
      model = extracted?.model ?? "disabled";
      const verified = extracted ? verifyClaims(extracted.claims, pages) : [];
      for (const v of verified) {
        const query = v.address ?? [v.facilityName, v.country].filter(Boolean).join(", ");
        const geo = query ? await this.d.geocoder.geocode(query).catch(() => null) : null;
        const flag = flagCoveredCountry(v.country, geo?.countryIso);
        await this.d.db.evidenceClaim.create({
          data: {
            documentId: doc.id,
            issuer: v.issuer,
            issueDate: v.issueDate,
            stage: v.stage,
            facilityName: v.facilityName,
            address: v.address,
            country: v.country,
            latitude: geo?.latitude,
            longitude: geo?.longitude,
            countryIso: flag.countryIso,
            coveredCountry: flag.covered,
            coveredReason: flag.reason,
            geocodeProvider: geo ? this.d.geocoder.provider : null,
            citations: v.citations as unknown as Prisma.InputJsonValue,
            reviewStatus: "in_review",
          },
        });
        created++;
      }
    }
    await this.d.db.evidenceDocument.update({
      where: { id: doc.id },
      data: { status: "in_review", sha256, sizeBytes: bytes.byteLength, pageCount: pages.length, textExtracted: !verdict.needsManualReview, rejectionReason: verdict.needsManualReview ?? null, uploadedAt: nowOf(this.d) },
    });
    await this.suppliers.markResponded(request.id);
    await this.d.audit.append({ action: "supplier.document_processed", actorSupplierRequestId: request.id, subjectId: doc.id, payload: { sha256, pages: pages.length, claims: created, model, manualReview: verdict.needsManualReview ?? null } });
    return { documentId: doc.id, status: "in_review" as const, rejectionReason: null, claims: created };
  }
}
