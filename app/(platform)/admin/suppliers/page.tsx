import { container } from "@/composition/root";
import { requirePageRole } from "../../_lib/guard";
import { ListingForm } from "./listing-form";
export const dynamic = "force-dynamic";

export default async function AdminSuppliers() {
  await requirePageRole("admin");
  const db = container().platform().deps.db;
  const listings = await db.supplierListing.findMany({ orderBy: { name: "asc" } });
  const docs = await db.evidenceDocument.findMany({ where: { status: "accepted" }, include: { request: { include: { supplier: true } } }, orderBy: { uploadedAt: "desc" }, take: 200 });
  const acceptedDocs = docs.map((d) => ({ id: d.id, label: `${d.request.supplier.name}: ${d.fileName}` }));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Supplier directory listings</h1>
      <p className="text-sm text-muted">Verification is only possible from evidence documents with at least one accepted claim.</p>
      <ListingForm />
      {listings.map((l) => (
        <div key={l.id} className="space-y-1">
          <p className="text-xs text-muted">{l.verifiedAt ? `Verified ${l.verifiedAt.toISOString().slice(0, 10)} from ${l.verifiedFromDocumentIds.length} doc(s)` : "Not verified"}</p>
          <ListingForm
            acceptedDocs={acceptedDocs}
            initial={{ id: l.id, name: l.name, summary: l.summary, website: l.website ?? "", city: l.city ?? "", country: l.countryIso ?? "", stages: l.stages, materials: l.materials, published: l.published, isExample: l.isExample }}
          />
        </div>
      ))}
    </div>
  );
}
