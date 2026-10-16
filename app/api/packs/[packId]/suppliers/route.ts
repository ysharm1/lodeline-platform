import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Add a supplier contact for selected parts; creates a tokenized request and sends the initial email. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ packId: string }> }) => {
  const ctx = await requireApiContext();
  const { packId } = await params;
  const body = await readJson(req);
  return json(await container().platform().suppliers.addRequest(ctx, packId, body), 201);
});
