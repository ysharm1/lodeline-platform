"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const STAGES: [string, string][] = [["mine", "Mining"], ["separation", "Separation / refining"], ["metal_alloy", "Metal / alloy"], ["magnet", "Magnet manufacture"], ["component", "Component"]];
const MATERIALS: [string, string][] = [["ndfeb", "NdFeB magnet"], ["smco", "SmCo magnet"], ["tungsten", "Tungsten"], ["tantalum", "Tantalum"]];

/** A buyer company lists what it supplies. Lodeline publishes it after a check. */
export function OwnListingForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 text-sm rounded border border-line bg-ink-2 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setBusy(true);
        setMsg(null);
        const r = await fetch("/api/listings/mine", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: f.get("name"), summary: f.get("summary"), website: f.get("website"), city: f.get("city"), country: f.get("country"), stages: f.getAll("stages"), materials: f.getAll("materials") }),
        });
        const j = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok) return setMsg({ ok: false, text: j?.error?.message ?? "Could not save the listing." });
        setMsg({ ok: true, text: "Submitted. Lodeline will check it before it appears in the directory." });
        form.reset();
        router.refresh();
      }}
    >
      <input name="name" required placeholder="Company or product line name" className="rounded border border-line bg-ink px-2 py-1" />
      <input name="website" placeholder="https://…" className="rounded border border-line bg-ink px-2 py-1" />
      <input name="city" placeholder="City" className="rounded border border-line bg-ink px-2 py-1" />
      <input name="country" required placeholder="Country (e.g. US)" className="rounded border border-line bg-ink px-2 py-1" />
      <textarea name="summary" placeholder="What you supply" className="sm:col-span-2 rounded border border-line bg-ink px-2 py-1" />
      <fieldset className="space-y-1"><legend className="text-muted">Stages</legend>{STAGES.map(([v, l]) => <label key={v} className="block"><input type="checkbox" name="stages" value={v} /> {l}</label>)}</fieldset>
      <fieldset className="space-y-1"><legend className="text-muted">Materials</legend>{MATERIALS.map(([v, l]) => <label key={v} className="block"><input type="checkbox" name="materials" value={v} /> {l}</label>)}</fieldset>
      <div className="sm:col-span-2 flex items-center gap-3">
        <button disabled={busy} className="rounded bg-paper text-ink px-3 py-1.5 font-medium disabled:opacity-50">{busy ? "Saving…" : "Submit listing"}</button>
        {msg ? <span className={msg.ok ? "text-ok" : "text-gap"}>{msg.text}</span> : null}
      </div>
    </form>
  );
}
