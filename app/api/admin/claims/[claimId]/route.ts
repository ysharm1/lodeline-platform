import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";
import type { ClaimEdit } from "@/services/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: { action: "accept" | "reject" | "edit", note?, edit?: {...} } */
export const PATCH = route(async (req: Request, { params }: { params: Promise<{ claimId: string }> }) => {
  const ctx = await requireApiContext();
  const { claimId } = await params;
  const body = await readJson(req);
  const claim = await container().platform().review.decide(ctx, claimId, { action: body.action, note: body.note, edit: body.edit as ClaimEdit | undefined });
  return json({ claim });
});
