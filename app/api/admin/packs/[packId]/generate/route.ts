import { container } from "@/composition/root";
import { requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";
import { requireAdmin } from "@/services/authorization";
import { loadPackPdfData } from "@/services/pack-pdf-data";
import { renderPackPdf } from "@/services/pack-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: render, store (S3) and mark the pack ready. */
export const POST = route(async (_req: Request, { params }: { params: Promise<{ packId: string }> }) => {
  const ctx = requireAdmin(await requireApiContext());
  const { packId } = await params;
  const c = container();
  const p = c.platform();
  const now = new Date();
  const pdf = await renderPackPdf(await loadPackPdfData(p.packs, packId, now));
  const key = `packs/${packId}/evidence-pack-${now.toISOString().replace(/[:.]/g, "-")}.pdf`;
  await c.storage.put({ key, body: new Uint8Array(pdf), contentType: "application/pdf" });
  await p.deps.db.evidencePack.update({ where: { id: packId }, data: { pdfFileKey: key, generatedAt: now, status: "ready" } });
  await c.audit.append({ action: "pack.generated", actorUserId: ctx.userId, subjectId: packId, payload: { key, bytes: pdf.byteLength } });
  return json({ ok: true, key });
});
