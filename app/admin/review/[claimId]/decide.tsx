"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Initial {
  issuer: string;
  issueDate: string;
  stage: string;
  facilityName: string;
  address: string;
  country: string;
}

export function DecideForm({ claimId, initial }: { claimId: string; initial: Initial }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function send(action: "accept" | "reject" | "edit", form: HTMLFormElement) {
    const f = new FormData(form);
    const edit: Record<string, string> = {};
    for (const k of Object.keys(initial) as (keyof Initial)[]) {
      const v = String(f.get(k) ?? "");
      if (v !== initial[k]) edit[k] = v;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/admin/claims/${claimId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, note: f.get("note"), edit: Object.keys(edit).length ? edit : undefined }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j?.error?.message ?? "Failed");
    if (action === "edit") router.refresh();
    else router.push("/admin/review");
  }
  return (
    <form className="space-y-2 text-sm" onSubmit={(e) => e.preventDefault()}>
      {(Object.keys(initial) as (keyof Initial)[]).map((k) =>
        k === "stage" ? (
          <label key={k} className="block">
            <span className="text-muted">stage</span>
            <select name="stage" defaultValue={initial.stage} className="w-full rounded border border-line bg-ink px-2 py-1">
              <option value="">(none)</option>
              {["mine", "separation", "metal_alloy", "magnet", "component"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        ) : (
          <label key={k} className="block">
            <span className="text-muted">{k}</span>
            <input name={k} defaultValue={initial[k]} className="w-full rounded border border-line bg-ink px-2 py-1" />
          </label>
        )
      )}
      <label className="block"><span className="text-muted">reviewer note</span><textarea name="note" className="w-full rounded border border-line bg-ink px-2 py-1" /></label>
      {err ? <p className="text-gap">{err}</p> : null}
      <div className="flex gap-2">
        <button disabled={busy} onClick={(e) => send("accept", e.currentTarget.form!)} className="rounded bg-ok text-ink px-3 py-1.5 font-medium">Accept (with edits)</button>
        <button disabled={busy} onClick={(e) => send("edit", e.currentTarget.form!)} className="rounded border border-line px-3 py-1.5">Save edits only</button>
        <button disabled={busy} onClick={(e) => send("reject", e.currentTarget.form!)} className="rounded border border-gap text-gap px-3 py-1.5">Reject</button>
      </div>
      <p className="text-xs text-muted">Editing address/country/facility re-runs geocoding and the covered-country flag.</p>
    </form>
  );
}
