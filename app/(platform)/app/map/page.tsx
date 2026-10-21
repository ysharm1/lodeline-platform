import Link from "next/link";
import { container } from "@/composition/root";
import type { Stage } from "@/domain/types";
import { isCoveredIso } from "@/services/countries";
import type { MarketplaceRow } from "@/services/directory";
import { MAP_STAGES, STAGE_COLORS, coverageGaps, parseMarketplaceParams, stageCountrySummary } from "@/services/marketplace";
import { MATERIAL_LABELS, STAGE_LABELS } from "@/services/stage-rules";
import { requirePageRole } from "../../_lib/guard";
import { loadTraces } from "../_lib";
import { SupplyChainMap } from "./supply-chain-map";
export const dynamic = "force-dynamic";

/** Supply-chain map: mine -> refine -> alloy -> magnet by country and supplier, linked to trace coverage gaps. */
export default async function SupplyChainMapPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePageRole("buyer", "admin");
  const sp = await searchParams;
  const f = parseMarketplaceParams(sp);
  let rows: MarketplaceRow[] = [];
  let unavailable = false;
  try {
    rows = await container().platform().directory.marketplace({ ...f, stages: f.stages.length ? f.stages : [...MAP_STAGES], activities: [] }, { limit: 1000 });
  } catch {
    unavailable = true;
  }
  const { traces } = await loadTraces(ctx);
  const traceId = typeof sp.trace === "string" ? sp.trace : null;
  const shown = traceId ? traces.filter((t) => t.id === traceId) : traces;
  const gaps = shown.flatMap((t) => coverageGaps(t.matrix).map((g) => ({ ...g, trace: t.name })));
  const stages = MAP_STAGES.map((s) => ({ key: s, label: STAGE_LABELS[s], color: STAGE_COLORS[s] }));
  const points = rows
    .filter((r) => r.latitude != null && r.longitude != null)
    .map((r) => ({ id: r.id, lat: r.latitude!, lng: r.longitude!, name: r.name, countryIso: r.countryIso, stages: r.stages.filter((s) => (MAP_STAGES as readonly string[]).includes(s)), covered: isCoveredIso(r.countryIso), approximate: !r.city }));
  const summary = stageCountrySummary(rows);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">Where marketplace suppliers sit in the chain for magnets, tungsten and tantalum: mining, separation / refining, metal / alloy, magnet manufacture. Filter by stage; open gaps from your traces link to China-free suppliers for that stage.</p>
      {unavailable ? <p className="text-sm text-gap">Map unavailable (database not configured).</p> : null}
      <section data-testid="supply-chain-map">
        <SupplyChainMap points={points} stages={stages} initial={f.stages.filter((s) => (MAP_STAGES as readonly string[]).includes(s))} />
      </section>

      <section className="space-y-2" data-testid="coverage-gaps">
        <h2 className="text-xl font-semibold">Open stages in your traces{traceId ? "" : ""}</h2>
        {traceId ? <p className="text-sm"><Link href="/app/map" className="underline">Show all traces</Link></p> : null}
        {gaps.length === 0 ? (
          <p className="text-sm text-muted">{traces.length ? "No open stages: every required stage has an accepted document." : "No traces yet. Open stages from your traces will show here."}</p>
        ) : (
          <ul className="divide-y divide-line rounded border border-line text-sm">
            {gaps.map((g, i) => (
              <li key={`${g.partId}-${g.stage}-${i}`} className="p-3 flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{g.partLabel}</strong> · {STAGE_LABELS[g.stage as Stage]} · {g.materials.map((m) => MATERIAL_LABELS[m]).join(", ") || "material to confirm"}{" "}
                  <span className={g.reason === "covered_country" ? "text-gap" : "text-muted"}>({g.reason === "covered_country" ? "record shows a covered country" : "no accepted document"})</span>
                  <span className="text-xs text-muted"> · {g.trace}</span>
                </span>
                <Link href={g.href} className="rounded border border-accent/60 px-2 py-1 text-accent">Find a China-free supplier for this open stage</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">By stage and country</h2>
        <div className="grid gap-3 md:grid-cols-2" data-testid="stage-country-table">
          {summary.map((s) => (
            <div key={s.stage} className="rounded border border-line p-3 text-sm space-y-1">
              <p className="font-medium" style={{ color: STAGE_COLORS[s.stage] }}>{STAGE_LABELS[s.stage]} · {s.total}</p>
              {s.countries.length === 0 ? <p className="text-muted">No suppliers listed.</p> : null}
              <ul className="space-y-0.5">
                {s.countries.slice(0, 8).map((c) => (
                  <li key={c.countryIso}>
                    <Link href={`/app/marketplace?stage=${s.stage}&country=${c.countryIso}`} className="underline">{c.countryIso}</Link>
                    <span className={c.covered ? "text-gap" : "text-muted"}> · {c.suppliers.length}: {c.suppliers.slice(0, 3).join(", ")}{c.suppliers.length > 3 ? "…" : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
