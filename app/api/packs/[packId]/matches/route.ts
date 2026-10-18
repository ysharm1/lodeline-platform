import { container } from "@/composition/root";
import { requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matchmaker: directory suppliers (outside CN/RU/IR/KP) for each open part x stage in the pack. */
export const GET = route(async (_req: Request, { params }: { params: Promise<{ packId: string }> }) => {
  const ctx = await requireApiContext();
  const { packId } = await params;
  const p = container().platform();
  await p.packs.assertAccess(ctx, packId);
  const { matrix } = await p.packs.view(packId);
  return json({ matches: await p.directory.matchesForMatrix(matrix) });
});
