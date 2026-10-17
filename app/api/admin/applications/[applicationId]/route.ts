import { container } from "@/composition/root";
import { ValidationError } from "@/domain/errors";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: { action: "approve" | "reject", note? }. Approve creates an unpublished, unverified listing. */
export const PATCH = route(async (req: Request, { params }: { params: Promise<{ applicationId: string }> }) => {
  const ctx = await requireApiContext();
  const { applicationId } = await params;
  const body = await readJson(req);
  const svc = container().platform().applications;
  if (body.action === "approve") {
    const r = await svc.approve(ctx, applicationId, body.note);
    return json({ application: r.application, listingId: r.listing.id });
  }
  if (body.action === "reject") return json({ application: await svc.reject(ctx, applicationId, body.note) });
  throw new ValidationError("ACTION_INVALID", "action must be approve or reject.");
});
