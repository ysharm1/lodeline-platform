import { ValidationError } from "@/domain/errors";
import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: { action: "complete", note? } closes a paid verification; { action: "cancel" } cancels an unpaid one. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ verificationId: string }> }) => {
  const ctx = await requireApiContext();
  const { verificationId } = await params;
  const body = await readJson(req);
  const v = container().platform().verifications;
  if (body.action === "complete") return json({ verification: await v.complete(ctx, verificationId, body.note) });
  if (body.action === "cancel") return json({ verification: await v.cancel(ctx, verificationId) });
  throw new ValidationError("ACTION_INVALID", "action must be complete or cancel.");
});
