import Link from "next/link";
import { requirePageRole } from "../_lib/guard";
import { LIVE_TRACE_DEMO_URL, loadTraces } from "./_lib";
export const dynamic = "force-dynamic";

/** Traces tab: the live demo link, then the org's traces with stage coverage. */
export default async function Traces() {
  const ctx = await requirePageRole("buyer", "admin");
  const { traces, unavailable } = await loadTraces(ctx);
  return (
    <div className="space-y-6">
      <section className="rounded border border-accent/60 bg-ink-2 p-5 flex flex-wrap items-center justify-between gap-4" data-testid="live-demo">
        <div className="space-y-1">
          <p className="text-lg font-semibold">See a finished trace first</p>
          <p className="text-sm text-muted">A fictional trace from parts list to mine: bilingual (EN / 繁中) supplier portal, reviewer confirmation and a page-cited evidence pack.</p>
        </div>
        <a href={LIVE_TRACE_DEMO_URL} target="_blank" rel="noopener" className="rounded bg-paper text-ink px-4 py-2 font-medium">Try the live trace demo ↗</a>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">Traces</h2>
          <Link href="/audit" className="text-sm underline">Start with a free parts-list check</Link>
        </div>
        {unavailable ? <p className="text-sm text-gap">Traces unavailable (database not configured).</p> : null}
        {!unavailable && traces.length === 0 ? (
          <p className="text-sm text-muted" data-testid="no-traces">
            No traces yet. Upload a parts list (no drawings) to the <Link href="/audit" className="underline">free check</Link>; from its results you can order a trace.
          </p>
        ) : null}
        <ul className="divide-y divide-line rounded border border-line" data-testid="trace-list">
          {traces.map((t) => (
            <li key={t.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <Link href={`/buyer/packs/${t.id}`} className="underline font-medium">{t.name}</Link>
                <p className="text-xs text-muted">{t.createdAt.toISOString().slice(0, 10)} · {t.status.replace("_", " ")} · {t.parts} part(s) in scope</p>
              </div>
              <div className="text-sm text-right">
                <p>{t.documented} of {t.cells} stage(s) documented</p>
                <p className="text-xs text-muted">
                  {t.coveredCountry ? <span className="text-gap">{t.coveredCountry} in a covered country · </span> : null}
                  {t.cells - t.documented} open · <Link href={`/app/map?trace=${t.id}`} className="underline">see gaps on the map</Link>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
