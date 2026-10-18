import { container } from "@/composition/root";
import { requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: the pack was re-checked; set the next due date. */
export const POST = route(async (_req: Request, { params }: { params: Promise<{ refreshId: string }> }) => {
  const ctx = await requireApiContext();
  const { refreshId } = await params;
  return json({ refresh: await container().platform().refresh.markRefreshed(ctx, refreshId) });
});
