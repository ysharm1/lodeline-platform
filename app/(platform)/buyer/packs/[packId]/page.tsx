import { notFound } from "next/navigation";
import { container } from "@/composition/root";
import { isDomainError } from "@/domain/errors";
import { STAGE_LABELS } from "@/services/stage-rules";
import { requirePageRole } from "../../../_lib/guard";
import { ActionButton } from "../../../_components/action-button";
import { AddSupplierForm } from "../../../_components/add-supplier-form";
import { PackMap } from "../../../_components/pack-map";
import { StatusPill, STATUS_STYLE } from "../../../_components/status";
import { Disclaimer } from "../../../_components/disclaimer";
import { ConflictDisclosure } from "../../../_components/conflict-disclosure";
import { packTier, refreshPlanFor, usd } from "@/services/pricing";
export const dynamic = "force-dynamic";

export default async function PackPage({ params, searchParams }: { params: Promise<{ packId: string }>; searchParams: Promise<{ paid?: string; cancelled?: string; refresh?: string }> }) {
  const ctx = await requirePageRole("buyer", "admin");
  const { packId } = await params;
  const sp = await searchParams;
  const p = container().platform();
  try {
    await p.packs.assertAccess(ctx, packId);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const { pack, matrix, accepted, requests } = await p.packs.view(packId);
  const tier = packTier(pack.tier);
  const activeSuppliers = requests.filter((r) => !r.revokedAt).length;
  const refresh = await p.refresh.forPack(pack.id);
  const refreshPlan = refreshPlanFor(pack.tier);
  const flaggedParts = pack.audit.parts.filter((x) => x.coverage !== "not_likely");
  const points = accepted
    .filter((c) => c.latitude != null && c.longitude != null)
    .map((c) => ({ id: c.id, lat: c.latitude!, lng: c.longitude!, label: c.facilityName ?? c.address ?? c.supplier.name, stage: c.stage ? STAGE_LABELS[c.stage] : "stage not stated", covered: c.coveredCountry }));

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="font-mono text-xs text-muted">Pack {pack.id.slice(0, 8)} · {pack.audit.sourceFileName}</p>
        <h1 className="text-3xl font-semibold">Evidence pack</h1>
        <p className="text-sm text-muted">
          Status: {pack.status.replace("_", " ")} · {tier.label} pack · Fixed fee {usd(pack.priceCents)}
          {Number.isFinite(tier.maxSuppliers) ? ` · ${activeSuppliers} of ${tier.maxSuppliers} suppliers used` : ""}
        </p>
        {sp.refresh ? <p className="text-sm text-accent">Refresh plan started. Stripe may take a moment to confirm.</p> : null}
        {sp.paid && !pack.paidAt ? <p className="text-sm text-accent">Payment received by Stripe; confirming… refresh in a moment.</p> : null}
        {sp.cancelled ? <p className="text-sm text-gap">Checkout was cancelled.</p> : null}
      </header>

      {!pack.paidAt ? (
        <section className="rounded border border-line bg-ink-2 p-4 space-y-2">
          <p>Complete checkout to start supplier outreach.</p>
          <ActionButton url={`/api/packs/${pack.id}/checkout`} label="Continue to checkout" />
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Status per part and stage</h2>
        <div className="flex flex-wrap gap-2 text-xs">{Object.entries(STATUS_STYLE).map(([k]) => <StatusPill key={k} status={k as keyof typeof STATUS_STYLE} />)}</div>
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full text-sm">
            <thead className="bg-ink-2 text-left text-muted"><tr><th className="p-3">Part</th><th className="p-3">Stages</th></tr></thead>
            <tbody>
              {matrix.map((r) => (
                <tr key={r.part.id} className="border-t border-line align-top">
                  <td className="p-3"><span className="font-mono">{r.part.partNumber ?? "-"}</span> {r.part.description}<div className="text-xs text-muted">{r.part.supplierName}</div></td>
                  <td className="p-3"><div className="flex flex-wrap gap-1">{r.cells.map((c) => <StatusPill key={c.stage} status={c.status}>{STAGE_LABELS[c.stage]}: {STATUS_STYLE[c.status].label}</StatusPill>)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">Only claims accepted by a Lodeline reviewer count as documented. Covered countries (CN, RU, IR, KP) are flagged deterministically from the stated country and the geocoded address.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Facilities from accepted evidence</h2>
        <PackMap points={points} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Supplier requests</h2>
        <ul className="divide-y divide-line rounded border border-line text-sm">
          {requests.length === 0 ? <li className="p-3 text-muted">No suppliers contacted yet.</li> : null}
          {requests.map((r) => (
            <li key={r.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>{r.supplier.name}</strong> · {r.supplier.contactEmail} · {r.partIds.length} part(s) · {r.outreachStatus}
                {r.revokedAt ? " · link revoked" : r.tokenExpiresAt < new Date() ? " · link expired" : ` · link expires ${r.tokenExpiresAt.toISOString().slice(0, 10)}`}
                {" · "}{r.documents.length} document(s)
              </span>
              {!r.revokedAt ? <ActionButton url={`/api/packs/${pack.id}/requests/${r.id}/revoke`} label="Revoke link" confirm="Revoke this supplier's upload link?" className="text-xs underline text-muted" /> : null}
            </li>
          ))}
        </ul>
        {pack.paidAt ? <AddSupplierForm packId={pack.id} parts={flaggedParts.map((x) => ({ id: x.id, label: `${x.partNumber ?? ""} ${x.description}`.trim(), supplierName: x.supplierName }))} /> : null}
      </section>

      {pack.paidAt ? (
        <section className="rounded border border-line bg-ink-2 p-4 space-y-2">
          <h2 className="font-semibold">Keep this pack current</h2>
          {refresh?.status === "active" ? (
            <p className="text-sm text-muted">
              Refresh plan active: {usd(refresh.monthlyCents)}/month. Next re-check due {refresh.nextRefreshDueAt?.toISOString().slice(0, 10) ?? "soon"}
              {refresh.lastRefreshedAt ? ` · last re-checked ${refresh.lastRefreshedAt.toISOString().slice(0, 10)}` : ""}. Manage or cancel from your Stripe receipt email.
            </p>
          ) : refreshPlan ? (
            <>
              <p className="text-sm text-muted">
                Supplier documents go stale and suppliers change. For {usd(refreshPlan.monthlyCents)}/month we re-check this pack every {Math.round(refreshPlan.intervalDays / 30)} months and
                update it. Cancel any time.
              </p>
              <ActionButton url={`/api/packs/${pack.id}/refresh`} label={`Start refresh plan (${usd(refreshPlan.monthlyCents)}/month)`} />
            </>
          ) : (
            <p className="text-sm text-muted">Refresh for a custom pack is quoted. Email <a className="underline" href="mailto:info@lodeline.org">info@lodeline.org</a>.</p>
          )}
        </section>
      ) : null}

      <section className="flex gap-4 items-center">
        <a href={`/api/packs/${pack.id}/pdf`} className="rounded border border-line px-3 py-1.5 text-sm">Download evidence pack PDF</a>
        <span className="text-xs text-muted">Generated from accepted evidence only.</span>
      </section>
      <ConflictDisclosure />
      <Disclaimer />
    </div>
  );
}
