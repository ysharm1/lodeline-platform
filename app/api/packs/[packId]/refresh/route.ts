import { container } from "@/composition/root";
import { requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Buyer starts a monthly refresh plan for a paid pack. Returns the Stripe Checkout URL. */
export const POST = route(async (_req: Request, { params }: { params: Promise<{ packId: string }> }) => {
  const ctx = await requireApiContext();
  const { packId } = await params;
  return json(await container().platform().refresh.start(ctx, packId));
});
