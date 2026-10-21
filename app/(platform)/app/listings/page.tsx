import Link from "next/link";
import { container } from "@/composition/root";
import { ACTIVITY_LABELS, type Activity } from "@/services/marketplace";
import { orgSummary } from "@/services/orgs";
import { MATERIAL_LABELS, STAGE_LABELS } from "@/services/stage-rules";
import { requirePageRole } from "../../_lib/guard";
import { OwnListingForm } from "../../buyer/listings/own-listing-form";
import { StatusBadge } from "../_components/status-badge";
export const dynamic = "force-dynamic";

/** My listings (seller side): a buyer company can also list what it supplies. */
export default async function MyListings() {
  const ctx = await requirePageRole("buyer", "admin");
  const p = container().platform();
  const [rows, org, intros] = await Promise.all([p.directory.listOwn(ctx), orgSummary(p.deps, ctx), p.intros.listForOrg(ctx)]);
  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h2 className="text-xl font-semibold">Your listings</h2>
        <p className="text-sm text-muted">
          If your company also supplies magnets, tungsten or tantalum, or works one of their upstream stages, list it here. Your account keeps buying.
          {org?.isSeller ? " Your company has the seller role." : " Adding a listing gives your company the seller role."} Listings start unpublished and unverified; Lodeline checks them before they appear, and only reviewed evidence marks one verified.
        </p>
      </section>
      <ul className="divide-y divide-line rounded border border-line text-sm" data-testid="my-listings">
        {rows.map((r) => (
          <li key={r.id} className="p-3 flex flex-wrap items-center gap-2">
            <strong>{r.name}</strong>
            <span className="text-muted">· {r.countryIso ?? "-"} · {[...r.stages.map((s) => STAGE_LABELS[s]), ...r.activities.map((a) => ACTIVITY_LABELS[a as Activity] ?? a)].join(", ")} · {r.materials.map((m) => MATERIAL_LABELS[m]).join(", ")}</span>
            <span className="text-xs text-muted">{r.published ? "published" : "awaiting Lodeline review"}</span>
            <StatusBadge listing={r} />
            {r.published ? <Link href={`/app/marketplace/${r.id}`} className="text-xs underline">view</Link> : null}
          </li>
        ))}
        {rows.length === 0 ? <li className="p-3 text-muted">No listings yet.</li> : null}
      </ul>
      <OwnListingForm />
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Your intro requests</h2>
        <ul className="divide-y divide-line rounded border border-line text-sm" data-testid="my-intros">
          {intros.map((i) => (
            <li key={i.id} className="p-3 flex justify-between">
              <Link href={`/app/marketplace/${i.listing.id}`} className="underline">{i.listing.name}</Link>
              <span className="text-muted">{i.status} · {i.createdAt.toISOString().slice(0, 10)}</span>
            </li>
          ))}
          {intros.length === 0 ? <li className="p-3 text-muted">No intro requests yet. Use Request intro on a marketplace listing.</li> : null}
        </ul>
      </section>
    </div>
  );
}
