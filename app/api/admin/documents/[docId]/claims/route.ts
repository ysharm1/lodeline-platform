import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: manual claim for scans / documents without extractable claims. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ docId: string }> }) => {
  const ctx = await requireApiContext();
  const { docId } = await params;
  const body = await readJson(req);
  return json({ claim: await container().platform().review.addManualClaim(ctx, docId, body as never) }, 201);
});
