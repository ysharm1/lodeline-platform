import { container } from "@/composition/root";
import { requireApiContext, route } from "@/http/api";
import { loadPackPdfData, packPdfDataForPart } from "@/services/pack-pdf-data";
import { NotFoundError } from "@/domain/errors";
import { renderPackPdf } from "@/services/pack-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Renders the pack PDF from the database (accepted claims only). `?part=<partId>` renders that part only. */
export const GET = route(async (req: Request, { params }: { params: Promise<{ packId: string }> }) => {
  const ctx = await requireApiContext();
  const { packId } = await params;
  const p = container().platform();
  await p.packs.assertAccess(ctx, packId);
  const partId = new URL(req.url).searchParams.get("part");
  let data = await loadPackPdfData(p.packs, packId);
  if (partId) {
    const one = packPdfDataForPart(data, partId);
    if (!one) throw new NotFoundError("PART_NOT_FOUND", "That part is not in this pack.");
    data = one;
  }
  const pdf = await renderPackPdf(data);
  const suffix = partId ? `-part-${partId.slice(0, 8)}` : "";
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="lodeline-evidence-pack-${packId.slice(0, 8)}${suffix}.pdf"`, "cache-control": "no-store" },
  });
});
