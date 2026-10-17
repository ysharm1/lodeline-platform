import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: { status: "new" | "contacted" | "closed" } */
export const PATCH = route(async (req: Request, { params }: { params: Promise<{ leadId: string }> }) => {
  const ctx = await requireApiContext();
  const { leadId } = await params;
  const body = await readJson(req);
  return json({ lead: await container().platform().leads.setStatus(ctx, leadId, body.status) });
});
