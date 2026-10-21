import Link from "next/link";
import { container } from "@/composition/root";
import { MATERIALS, STAGES } from "@/domain/types";
import { isCoveredIso } from "@/services/countries";
import { ACTIVITIES, ACTIVITY_LABELS, PROSPECT_LABEL, REGIONS, parseMarketplaceParams, type Activity } from "@/services/marketplace";
import { MATERIAL_LABELS, STAGE_LABELS } from "@/services/stage-rules";
import type { MarketplaceRow } from "@/services/directory";
import { requirePageRole } from "../../_lib/guard";
import { AskBox } from "../../suppliers/ask-box";
import { PackMap } from "../../_components/pack-map";
import { StatusBadge } from "../_components/status-badge";
export const dynamic = "force-dynamic";

const stageLabel = (s: string) => STAGE_LABELS[s as keyof typeof STAGE_LABELS] ?? ACTIVITY_LABELS[s as Activity] ?? s;
const sel = "rounded border border-line bg-ink-2 px-2 py-1.5";

/** Marketplace tab: China-free supplier search with stage, material, region, country and status filters. */
export default async function Marketplace({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageRole("buyer", "admin");
  const sp = await searchParams;
  const f = parseMarketplaceParams(sp);
  let rows: MarketplaceRow[] = [];
  let unavailable = false;
  try {
    rows = await container().platform().directory.marketplace(f);
  } catch {
    unavailable = true;
  }
  const points = rows
    .filter((r) => r.latitude != null && r.longitude != null)
    .map((r) => ({ id: r.id, lat: r.latitude!, lng: r.longitude!, label: r.name, stage: [...r.stages, ...r.activities].map(stageLabel).join(", "), covered: isCoveredIso(r.countryIso) }));
  const stageValue = f.stages[0] ?? f.activities[0] ?? "";
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Suppliers outside China, Russia, Iran and North Korea, by supply-chain stage. Rows marked &ldquo;{PROSPECT_LABEL}&rdquo; come from public sources and have not been checked against documents.
        &ldquo;Verified from evidence&rdquo; means a Lodeline reviewer accepted supplier documents for the listed stages; it is not a certification. Contact details are never shown: use Request intro.
      </p>
      <AskBox hrefBase="/app/marketplace" />
      <form className="grid md:grid-cols-6 gap-2 text-sm" method="get" data-testid="marketplace-filters">
        <input name="q" defaultValue={f.q} placeholder="Search name or summary" className={`md:col-span-2 ${sel}`} />
        <select name="stage" defaultValue={stageValue} className={sel} aria-label="Stage">
          <option value="">Any stage</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          {ACTIVITIES.map((a) => <option key={a} value={a}>{ACTIVITY_LABELS[a]}</option>)}
        </select>
        <select name="material" defaultValue={f.materials[0] ?? ""} className={sel} aria-label="Material">
          <option value="">Any material</option>
          {MATERIALS.filter((m) => m !== "other").map((m) => <option key={m} value={m}>{MATERIAL_LABELS[m]}</option>)}
        </select>
        <select name="region" defaultValue={f.regions[0] ?? ""} className={sel} aria-label="Region">
          <option value="">Any region</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input name="country" defaultValue={f.countries.join(",")} placeholder="Country (e.g. JP)" className={sel} aria-label="Country" />
        <select name="status" defaultValue={f.status ?? ""} className={sel} aria-label="Status">
          <option value="">Any status</option>
          <option value="verified">Verified from evidence</option>
          <option value="unverified">Not verified</option>
          <option value="prospect">{PROSPECT_LABEL}</option>
        </select>
        <label className="md:col-span-3 flex items-center gap-2"><input type="checkbox" name="excludeCovered" value="1" defaultChecked={f.excludeCovered} /> China-free only (no location in a covered country)</label>
        <button className="md:col-span-2 justify-self-start rounded bg-paper text-ink px-3 py-1.5 font-medium">Search</button>
      </form>
      {unavailable ? <p className="text-gap text-sm">Marketplace unavailable (database not configured).</p> : null}
      <section data-testid="marketplace-map">
        <PackMap points={points} emptyText="No listings with a map position match." />
        {points.length ? <p className="text-xs text-muted">Pins are country-level (approximate) unless a city is listed. Red = covered country.</p> : null}
      </section>
      <p className="text-sm text-muted">{rows.length} listing(s)</p>
      <ul className="divide-y divide-line rounded border border-line" data-testid="marketplace-results">
        {rows.map((r) => (
          <li key={r.id} className="p-3 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/app/marketplace/${r.id}`} className="font-medium underline">{r.name}</Link>
              <StatusBadge listing={r} />
            </div>
            <p className="text-sm text-muted">
              {[r.countryIso, r.region].filter(Boolean).join(" · ")} · {[...r.stages, ...r.activities].map(stageLabel).join(", ") || "stage not stated"} · {r.materials.map((m) => MATERIAL_LABELS[m as keyof typeof MATERIAL_LABELS]).join(", ")}
              {r.productionStatus ? ` · ${r.productionStatus}` : ""}
            </p>
            {r.summary ? <p className="text-sm">{r.summary}</p> : null}
          </li>
        ))}
        {!unavailable && rows.length === 0 ? <li className="p-3 text-muted text-sm">No listings match.</li> : null}
      </ul>
    </div>
  );
}
