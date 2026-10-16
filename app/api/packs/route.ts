import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Buyer orders an evidence pack for an audit they hold the link for. Returns the Stripe Checkout URL. */
export const POST = route(async (req: Request) => {
  const ctx = await requireApiContext();
  const body = await readJson(req);
  const r = await container().platform().packs.create(ctx, { auditId: body.auditId, accessToken: body.accessToken });
  return json(r, 201);
});

export const GET = route(async () => {
  const ctx = await requireApiContext();
  return json({ packs: await container().platform().packs.listForBuyer(ctx) });
});
