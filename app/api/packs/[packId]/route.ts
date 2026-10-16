import { container } from "@/composition/root";
import { requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ packId: string }> }) => {
  const ctx = await requireApiContext();
  const { packId } = await params;
  const p = container().platform();
  await p.packs.assertAccess(ctx, packId);
  const v = await p.packs.view(packId);
  return json({
    pack: { id: v.pack.id, status: v.pack.status, paidAt: v.pack.paidAt, priceCents: v.pack.priceCents },
    matrix: v.matrix,
    acceptedClaims: v.accepted.map((c) => ({ id: c.id, stage: c.stage, facilityName: c.facilityName, countryIso: c.countryIso, latitude: c.latitude, longitude: c.longitude, coveredCountry: c.coveredCountry })),
  });
});
