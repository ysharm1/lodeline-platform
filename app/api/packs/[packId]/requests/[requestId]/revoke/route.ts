import { container } from "@/composition/root";
import { requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (_req: Request, { params }: { params: Promise<{ requestId: string }> }) => {
  const ctx = await requireApiContext();
  const { requestId } = await params;
  await container().platform().suppliers.revoke(ctx, requestId);
  return json({ ok: true });
});
