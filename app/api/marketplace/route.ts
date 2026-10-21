import { container } from "@/composition/root";
import { requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";
import { listingStatusLabel, parseMarketplaceParams } from "@/services/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Signed-in marketplace search. Public business data only: no contact details. */
export const GET = route(async (req: Request) => {
  await requireApiContext();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const rows = await container().platform().directory.marketplace(parseMarketplaceParams(sp));
  return json({
    listings: rows.map((r) => ({
      id: r.id, name: r.name, summary: r.summary, website: r.website, countryIso: r.countryIso, countries: r.countries, region: r.region,
      stages: r.stages, activities: r.activities, materials: r.materials, productionStatus: r.productionStatus,
      status: listingStatusLabel(r).label, verified: r.verified, isExample: r.isExample, latitude: r.latitude, longitude: r.longitude,
    })),
  });
});
