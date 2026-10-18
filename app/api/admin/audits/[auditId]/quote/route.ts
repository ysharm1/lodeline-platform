import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: set a fixed Custom-tier quote { priceCents, maxSuppliers? } for an audit larger than Standard. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ auditId: string }> }) => {
  const ctx = await requireApiContext();
  const { auditId } = await params;
  const body = await readJson(req);
  return json(await container().platform().packs.setQuote(ctx, auditId, body));
});
