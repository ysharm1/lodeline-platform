"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ListingValues {
  id?: string;
  name: string;
  summary: string;
  website: string;
  city: string;
  country: string;
  stages: string[];
  materials: string[];
  published: boolean;
  isExample: boolean;
}
const STAGES = ["mine", "separation", "metal_alloy", "magnet", "component"];
const MATS = ["ndfeb", "smco", "tungsten", "tantalum"];

export function ListingForm({ initial, acceptedDocs }: { initial?: ListingValues; acceptedDocs?: { id: string; label: string }[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const v = initial ?? { name: "", summary: "", website: "", city: "", country: "", stages: [], materials: [], published: false, isExample: false };
  async function call(url: string, method: string, body?: unknown) {
    setErr(null);
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(j?.error?.message ?? "Failed");
    router.refresh();
  }
  return (
    <form
      className="space-y-2 rounded border border-line bg-ink-2 p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body = { name: f.get("name"), summary: f.get("summary"), website: f.get("website"), city: f.get("city"), country: f.get("country"), stages: f.getAll("stages"), materials: f.getAll("materials"), published: f.get("published") === "on", isExample: f.get("isExample") === "on" };
        call(v.id ? `/api/admin/listings/${v.id}` : "/api/admin/listings", v.id ? "PATCH" : "POST", body);
        if (!v.id) e.currentTarget.reset();
      }}
    >
      <div className="grid md:grid-cols-4 gap-2">
        <input name="name" defaultValue={v.name} required placeholder="Name" className="rounded border border-line bg-ink px-2 py-1" />
        <input name="city" defaultValue={v.city} placeholder="City" className="rounded border border-line bg-ink px-2 py-1" />
        <input name="country" defaultValue={v.country} placeholder="Country / ISO" className="rounded border border-line bg-ink px-2 py-1" />
        <input name="website" defaultValue={v.website} placeholder="https://" className="rounded border border-line bg-ink px-2 py-1" />
      </div>
      <textarea name="summary" defaultValue={v.summary} placeholder="Summary" className="w-full rounded border border-line bg-ink px-2 py-1" />
      <div className="flex flex-wrap gap-3">
        {STAGES.map((s) => <label key={s}><input type="checkbox" name="stages" value={s} defaultChecked={v.stages.includes(s)} /> {s}</label>)}
        <span className="text-muted">|</span>
        {MATS.map((m) => <label key={m}><input type="checkbox" name="materials" value={m} defaultChecked={v.materials.includes(m)} /> {m}</label>)}
        <span className="text-muted">|</span>
        <label><input type="checkbox" name="published" defaultChecked={v.published} /> published</label>
        <label><input type="checkbox" name="isExample" defaultChecked={v.isExample} /> example row</label>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <button className="rounded bg-paper text-ink px-3 py-1 font-medium">{v.id ? "Save" : "Create listing"}</button>
        {v.id ? <button type="button" onClick={() => confirm("Delete listing?") && call(`/api/admin/listings/${v.id}`, "DELETE")} className="text-gap underline">Delete</button> : null}
        {v.id && acceptedDocs ? (
          <select
            className="rounded border border-line bg-ink px-2 py-1"
            defaultValue=""
            onChange={(e) => e.target.value && call(`/api/admin/listings/${v.id}/verify`, "POST", { documentIds: e.target.value === "__clear" ? [] : [e.target.value] })}
          >
            <option value="">Verify from accepted evidence…</option>
            <option value="__clear">Clear verification</option>
            {acceptedDocs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        ) : null}
      </div>
      {err ? <p className="text-gap">{err}</p> : null}
    </form>
  );
}
