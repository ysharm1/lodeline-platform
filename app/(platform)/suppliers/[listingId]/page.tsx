import { notFound } from "next/navigation";
import { container } from "@/composition/root";
import { MATERIAL_LABELS, STAGE_LABELS } from "@/services/stage-rules";
import { Disclaimer } from "../../_components/disclaimer";
export const dynamic = "force-dynamic";

export default async function Listing({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(listingId)) notFound();
  const l = await container().platform().deps.db.supplierListing.findFirst({ where: { id: listingId, published: true } });
  if (!l) notFound();
  return (
    <div className="max-w-2xl space-y-3">
      <h1 className="text-2xl font-semibold">{l.name}</h1>
      {l.isExample ? <p className="text-sm text-accent">Example listing for demonstration. Not a real company or claim.</p> : null}
      <p className="text-muted">{[l.city, l.countryIso].filter(Boolean).join(", ")}</p>
      <p>{l.summary}</p>
      <p className="text-sm">Stages: {l.stages.map((s) => STAGE_LABELS[s]).join(", ") || "-"}</p>
      <p className="text-sm">Materials: {l.materials.map((m) => MATERIAL_LABELS[m]).join(", ") || "-"}</p>
      <p className="text-sm">{l.verifiedAt ? `Verified ${l.verifiedAt.toISOString().slice(0, 10)} from ${l.verifiedFromDocumentIds.length} reviewed evidence document(s).` : "Not verified by Lodeline."}</p>
      {l.website ? <a className="underline text-sm" href={l.website} rel="nofollow noopener" target="_blank">{l.website}</a> : null}
      <Disclaimer />
    </div>
  );
}
