/**
 * One-click release: after review, staff render the pack PDF from accepted
 * claims, store it, mark the pack delivered and email the buyer a link to it.
 * Refused while any claim for the pack is still waiting for review, so a buyer
 * never receives a pack with unreviewed evidence silently left out.
 */
import { ConflictError } from "@/domain/errors";
import type { AuthContext } from "@/domain/types";
import { requireAdmin } from "./authorization";
import { nowOf, type PlatformDeps } from "./deps";
import { loadPackPdfData } from "./pack-pdf-data";
import { renderPackPdf } from "./pack-pdf";
import type { PackService } from "./packs";

export async function releasePack(d: PlatformDeps, packs: PackService, ctx: AuthContext, packId: string) {
  const admin = requireAdmin(ctx);
  const pack = await packs.assertAccess(admin, packId);
  if (!pack.paidAt) throw new ConflictError("PACK_NOT_PAID", "The pack has not been paid.");
  const pending = await d.db.evidenceClaim.count({ where: { reviewStatus: "in_review", document: { request: { packId } } } });
  if (pending) throw new ConflictError("REVIEW_PENDING", `${pending} claim(s) for this pack are still waiting for review.`);
  const now = nowOf(d);
  const data = await loadPackPdfData(packs, packId, now);
  const pdf = await renderPackPdf(data);
  const key = `packs/${packId}/evidence-pack-${now.toISOString().replace(/[:.]/g, "-")}.pdf`;
  await d.storage.put({ key, body: new Uint8Array(pdf), contentType: "application/pdf" });
  await d.db.evidencePack.update({ where: { id: packId }, data: { pdfFileKey: key, generatedAt: now, releasedAt: now, status: "delivered" } });
  const buyer = pack.createdById ? await d.db.user.findUnique({ where: { id: pack.createdById } }) : null;
  const link = `${d.baseUrl.replace(/\/$/, "")}/buyer/packs/${packId}`;
  let emailed = false;
  if (buyer) {
    try {
      await d.email.send({
        to: buyer.email,
        subject: "Your Lodeline evidence pack is ready",
        text:
          `Hello,\n\nYour evidence pack for ${data.sourceFileName} has been reviewed and released.\n` +
          `${data.matrix.length} part(s), ${data.claims.length} accepted claim(s), ${data.documents.length} document(s).\n\n` +
          `View it and download the PDF (whole pack or per part): ${link}\n\n` +
          `Lodeline provides supply-chain documentation and analysis, not legal advice or government certification.\n`,
      });
      emailed = true;
    } catch {
      emailed = false;
    }
  }
  await d.audit.append({ action: "pack.released", actorUserId: admin.userId, subjectId: packId, payload: { key, bytes: pdf.byteLength, claims: data.claims.length, emailed } });
  return { ok: true, key, emailed, status: "delivered" as const };
}
