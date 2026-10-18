import { container } from "@/composition/root";
import { MATERIAL_LABELS, STAGE_LABELS } from "@/services/stage-rules";
import { requirePageRole } from "../../_lib/guard";
import { OwnListingForm } from "./own-listing-form";
export const dynamic = "force-dynamic";

/** Dual-role accounts: a buyer company can also list the supplies it sells. */
export default async function MyListings() {
  const ctx = await requirePageRole("buyer", "admin");
  const rows = await container().platform().directory.listOwn(ctx);
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Your supplier listings</h1>
        <p className="text-sm text-muted">
          If your company also supplies magnets, tungsten or tantalum, or works one of their upstream stages, list it here. Your account keeps buying as well.
          Listings start unpublished and unverified; Lodeline checks them before they appear in the directory, and only reviewed evidence can mark one verified.
        </p>
      </header>
      <ul className="divide-y divide-line rounded border border-line text-sm">
        {rows.map((r) => (
          <li key={r.id} className="p-3">
            <strong>{r.name}</strong> · {r.countryIso ?? "-"} · {r.stages.map((s) => STAGE_LABELS[s]).join(", ")} · {r.materials.map((m) => MATERIAL_LABELS[m]).join(", ")}
            <span className="ml-2 text-xs text-muted">{r.published ? "published" : "awaiting Lodeline review"} · {r.verifiedAt ? "verified from evidence" : "not verified"}</span>
          </li>
        ))}
        {rows.length === 0 ? <li className="p-3 text-muted">No listings yet.</li> : null}
      </ul>
      <OwnListingForm />
    </div>
  );
}
