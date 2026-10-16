import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: { documentIds: string[] } of ACCEPTED evidence documents; [] clears verification. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ listingId: string }> }) => {
  const ctx = await requireApiContext();
  const { listingId } = await params;
  const body = await readJson(req);
  return json({ listing: await container().platform().directory.verify(ctx, listingId, body.documentIds) });
});
