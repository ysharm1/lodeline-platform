import Link from "next/link";
import { notFound } from "next/navigation";
import { container } from "@/composition/root";
import { ACTIVITY_LABELS, type Activity } from "@/services/marketplace";
import { MATERIAL_LABELS, STAGE_LABELS } from "@/services/stage-rules";
import { requirePageRole } from "../../../_lib/guard";
import { StatusBadge } from "../../_components/status-badge";
import { RequestIntro } from "./request-intro";
export const dynamic = "force-dynamic";

/** One marketplace listing. Public business data only; contact goes through Lodeline. */
export default async function MarketplaceListing({ params }: { params: Promise<{ listingId: string }> }) {
  const ctx = await requirePageRole("buyer", "admin");
  const { listingId } = await params;
  const l = await container().platform().directory.marketplaceListing(listingId);
  if (!l) notFound();
  const own = !!ctx.orgId && l.orgId === ctx.orgId;
  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/app/marketplace" className="text-sm underline">← Marketplace</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-semibold">{l.name}</h2>
        <StatusBadge listing={l} />
      </div>
      {l.isExample ? <p className="text-sm text-accent">Example listing for demonstration. Not a real company or claim.</p> : null}
      {l.summary ? <p>{l.summary}</p> : null}
      <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm">
        <dt className="text-muted">Headquarters</dt><dd>{l.hqCountry ?? l.countryIso ?? "-"}</dd>
        <dt className="text-muted">Facility countries</dt><dd>{l.countries.join(", ") || l.countryIso || "-"}</dd>
        <dt className="text-muted">Region</dt><dd>{l.region ?? "-"}</dd>
        <dt className="text-muted">Stages</dt><dd>{l.stages.map((s) => STAGE_LABELS[s]).join(", ") || "-"}</dd>
        <dt className="text-muted">Other activities</dt><dd>{l.activities.map((a) => ACTIVITY_LABELS[a as Activity] ?? a).join(", ") || "-"}</dd>
        <dt className="text-muted">Materials</dt><dd>{l.materials.map((m) => MATERIAL_LABELS[m]).join(", ") || "-"}</dd>
        <dt className="text-muted">Production status</dt><dd>{l.productionStatus ?? "-"}</dd>
        <dt className="text-muted">DFARS 7052 record</dt>
        <dd>{l.verifiedAt ? `Lodeline reviewed ${l.verifiedFromDocumentIds.length} supplier document(s) on ${l.verifiedAt.toISOString().slice(0, 10)}.` : "No documents checked by Lodeline yet."}</dd>
        <dt className="text-muted">Website</dt><dd>{l.website ? <a className="underline" href={l.website} rel="nofollow noopener" target="_blank">{l.website}</a> : "-"}</dd>
      </dl>
      {l.publicSources.length ? (
        <div className="text-sm space-y-1">
          <p className="text-muted">Public sources</p>
          <ul className="list-disc pl-5">{l.publicSources.map((s) => <li key={s}><a className="underline break-all" href={s} rel="nofollow noopener" target="_blank">{s}</a></li>)}</ul>
        </div>
      ) : null}
      <RequestIntro listingId={l.id} disabledReason={l.isExample ? "This is a fictional example listing; there is no one to introduce." : own ? "This is your own listing." : undefined} />
      <p className="text-xs text-muted">Lodeline records what documents say. It does not certify suppliers or make compliance findings.</p>
    </div>
  );
}
