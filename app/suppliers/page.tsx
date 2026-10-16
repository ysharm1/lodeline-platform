import Link from "next/link";
import { container } from "@/composition/root";
import { parseFilterParams } from "@/services/directory";
import { MATERIAL_LABELS, STAGE_LABELS } from "@/services/stage-rules";
import { MATERIALS, STAGES } from "@/domain/types";
import { AskBox } from "./ask-box";
import { Disclaimer } from "../_components/disclaimer";
export const dynamic = "force-dynamic";

export default async function Directory({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = parseFilterParams(sp);
  let rows: Awaited<ReturnType<ReturnType<ReturnType<typeof container>["platform"]>["directory"]["search"]>> = [];
  let unavailable = false;
  try {
    rows = await container().platform().directory.search(f);
  } catch {
    unavailable = true;
  }
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Supplier directory</h1>
        <p className="text-muted text-sm">Upstream suppliers for magnets, tungsten and tantalum. &ldquo;Verified&rdquo; means a Lodeline reviewer accepted supplier evidence for the listed stages; it is not a certification.</p>
      </header>
      <AskBox />
      <form className="grid md:grid-cols-6 gap-2 text-sm" method="get">
        <input name="q" defaultValue={f.q} placeholder="Search name, summary, city" className="md:col-span-2 rounded border border-line bg-ink-2 px-2 py-1.5" />
        <select name="material" defaultValue={f.materials[0] ?? ""} className="rounded border border-line bg-ink-2 px-2 py-1.5">
          <option value="">Any material</option>
          {MATERIALS.filter((m) => m !== "other").map((m) => <option key={m} value={m}>{MATERIAL_LABELS[m]}</option>)}
        </select>
        <select name="stage" defaultValue={f.stages[0] ?? ""} className="rounded border border-line bg-ink-2 px-2 py-1.5">
          <option value="">Any stage</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <input name="country" defaultValue={f.countries.join(",")} placeholder="Country (e.g. US)" className="rounded border border-line bg-ink-2 px-2 py-1.5" />
        <label className="flex items-center gap-2"><input type="checkbox" name="verified" value="1" defaultChecked={f.verifiedOnly} /> Verified only</label>
        <button className="md:col-span-6 justify-self-start rounded bg-paper text-ink px-3 py-1.5 font-medium">Search</button>
      </form>
      {unavailable ? <p className="text-gap text-sm">Directory unavailable (database not configured).</p> : null}
      <ul className="divide-y divide-line rounded border border-line">
        {rows.map((r) => (
          <li key={r.id} className="p-3 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/suppliers/${r.id}`} className="font-medium underline">{r.name}</Link>
              {r.isExample ? <span className="rounded border border-accent/60 px-1.5 text-xs text-accent">Example listing</span> : null}
              {r.verified ? <span className="rounded border border-ok/60 px-1.5 text-xs text-ok">Verified from evidence</span> : <span className="text-xs text-muted">Not verified</span>}
            </div>
            <p className="text-sm text-muted">{[r.city, r.countryIso].filter(Boolean).join(", ")} · {r.stages.map((s) => STAGE_LABELS[s as keyof typeof STAGE_LABELS]).join(", ")} · {r.materials.map((m) => MATERIAL_LABELS[m as keyof typeof MATERIAL_LABELS]).join(", ")}</p>
            {r.summary ? <p className="text-sm">{r.summary}</p> : null}
          </li>
        ))}
        {!unavailable && rows.length === 0 ? <li className="p-3 text-muted text-sm">No listings match.</li> : null}
      </ul>
      <Disclaimer />
    </div>
  );
}
