import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: { contactEmail, contactName?, facilities } starts a paid supplier verification and emails the payment link. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ listingId: string }> }) => {
  const ctx = await requireApiContext();
  const { listingId } = await params;
  const body = await readJson(req);
  return json(await container().platform().verifications.create(ctx, listingId, body), 201);
});
