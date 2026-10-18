import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Buyer lists its own supplies (org gains the seller role). Starts unpublished and unverified. */
export const POST = route(async (req: Request) => {
  const ctx = await requireApiContext();
  const body = await readJson(req);
  const row = await container().platform().directory.submitOwn(ctx, body);
  return json({ listing: { id: row.id, name: row.name, published: row.published, verified: !!row.verifiedAt } }, 201);
});

export const GET = route(async () => {
  const ctx = await requireApiContext();
  const rows = await container().platform().directory.listOwn(ctx);
  return json({ listings: rows.map((r) => ({ id: r.id, name: r.name, published: r.published, verified: !!r.verifiedAt, stages: r.stages, materials: r.materials, countryIso: r.countryIso })) });
});
