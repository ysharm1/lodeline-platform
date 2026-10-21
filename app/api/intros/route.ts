import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Request intro" to a marketplace listing. Routed to Lodeline; no supplier contact details are returned. */
export const POST = route(async (req: Request) => {
  const ctx = await requireApiContext();
  const body = await readJson(req, 8 * 1024);
  const r = await container().platform().intros.request(ctx, body.listingId, body.message);
  return json({ id: r.request.id, status: r.request.status, duplicate: r.duplicate }, r.duplicate ? 200 : 201);
});

export const GET = route(async () => {
  const ctx = await requireApiContext();
  const rows = await container().platform().intros.listForOrg(ctx);
  return json({ intros: rows.map((r) => ({ id: r.id, listingId: r.listingId, listingName: r.listing.name, status: r.status, createdAt: r.createdAt })) });
});
