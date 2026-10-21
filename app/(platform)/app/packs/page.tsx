import Link from "next/link";
import { requirePageRole } from "../../_lib/guard";
import { loadTraces } from "../_lib";
export const dynamic = "force-dynamic";

const READY = new Set(["ready", "delivered"]);

/** Evidence packs tab: per-part, page-cited PDFs once a pack is ready. */
export default async function EvidencePacks() {
  const ctx = await requirePageRole("buyer", "admin");
  const { traces, unavailable } = await loadTraces(ctx);
  const ready = traces.filter((t) => READY.has(t.status));
  const inProgress = traces.filter((t) => !READY.has(t.status));
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">Each pack records what supplier documents say for each part and stage, with page citations. It is not a compliance finding or certification.</p>
      {unavailable ? <p className="text-sm text-gap">Packs unavailable (database not configured).</p> : null}
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Ready</h2>
        <ul className="divide-y divide-line rounded border border-line" data-testid="ready-packs">
          {ready.map((t) => (
            <li key={t.id} className="p-3 flex flex-wrap justify-between gap-2 text-sm">
              <Link href={`/buyer/packs/${t.id}`} className="underline">{t.name}</Link>
              <span className="flex gap-3">
                <span className="text-muted">{t.documented}/{t.cells} stages documented</span>
                <a href={`/api/packs/${t.id}/pdf`} className="underline">Download PDF</a>
              </span>
            </li>
          ))}
          {ready.length === 0 ? <li className="p-3 text-sm text-muted">No finished packs yet.</li> : null}
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">In progress</h2>
        <ul className="divide-y divide-line rounded border border-line">
          {inProgress.map((t) => (
            <li key={t.id} className="p-3 flex justify-between text-sm">
              <Link href={`/buyer/packs/${t.id}`} className="underline">{t.name}</Link>
              <span className="text-muted">{t.status.replace("_", " ")}</span>
            </li>
          ))}
          {inProgress.length === 0 ? <li className="p-3 text-sm text-muted">Nothing in progress.</li> : null}
        </ul>
      </section>
    </div>
  );
}
