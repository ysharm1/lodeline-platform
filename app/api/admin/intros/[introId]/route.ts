import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: { status: "new" | "introduced" | "closed" } */
export const PATCH = route(async (req: Request, { params }: { params: Promise<{ introId: string }> }) => {
  const ctx = await requireApiContext();
  const { introId } = await params;
  const body = await readJson(req);
  const row = await container().platform().intros.setStatus(ctx, introId, body.status);
  return json({ id: row.id, status: row.status });
});
