import { container } from "@/composition/root";
import { requireApiContext, route } from "@/http/api";
import { loadPackPdfData } from "@/services/pack-pdf-data";
import { renderPackPdf } from "@/services/pack-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Renders the pack PDF from the database (accepted claims only). */
export const GET = route(async (_req: Request, { params }: { params: Promise<{ packId: string }> }) => {
  const ctx = await requireApiContext();
  const { packId } = await params;
  const p = container().platform();
  await p.packs.assertAccess(ctx, packId);
  const pdf = await renderPackPdf(await loadPackPdfData(p.packs, packId));
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="lodeline-evidence-pack-${packId.slice(0, 8)}.pdf"`, "cache-control": "no-store" },
  });
});
