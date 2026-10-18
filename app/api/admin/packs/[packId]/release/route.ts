import { container } from "@/composition/root";
import { requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";
import { releasePack } from "@/services/pack-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin one-click release: render + store the PDF, mark delivered, email the buyer. Refused while claims are pending. */
export const POST = route(async (_req: Request, { params }: { params: Promise<{ packId: string }> }) => {
  const ctx = await requireApiContext();
  const { packId } = await params;
  const p = container().platform();
  return json(await releasePack(p.deps, p.packs, ctx, packId));
});
