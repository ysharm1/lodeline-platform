import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { params: Promise<{ listingId: string }> };

export const PATCH = route(async (req: Request, { params }: P) => {
  const ctx = await requireApiContext();
  const { listingId } = await params;
  return json({ listing: await container().platform().directory.update(ctx, listingId, await readJson(req)) });
});

export const DELETE = route(async (_req: Request, { params }: P) => {
  const ctx = await requireApiContext();
  const { listingId } = await params;
  await container().platform().directory.remove(ctx, listingId);
  return json({ ok: true });
});
