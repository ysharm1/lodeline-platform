"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddSupplierForm({ packId, parts }: { packId: string; parts: { id: string; label: string; supplierName: string | null }[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3 rounded border border-line bg-ink-2 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setErr(null);
        const res = await fetch(`/api/packs/${packId}/suppliers`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: f.get("name"), contactEmail: f.get("contactEmail"), contactName: f.get("contactName"), country: f.get("country"), partIds: f.getAll("partIds") }),
        });
        const json = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return setErr(json?.error?.message ?? "Failed.");
        (e.target as HTMLFormElement).reset();
        router.refresh();
      }}
    >
      <h3 className="font-semibold">Request documents from a supplier</h3>
      <div className="grid md:grid-cols-2 gap-2">
        <input name="name" required placeholder="Supplier company" className="rounded border border-line bg-ink px-2 py-1.5 text-sm" />
        <input name="contactEmail" type="email" required placeholder="Contact email" className="rounded border border-line bg-ink px-2 py-1.5 text-sm" />
        <input name="contactName" placeholder="Contact name (optional)" className="rounded border border-line bg-ink px-2 py-1.5 text-sm" />
        <input name="country" placeholder="Country (optional)" className="rounded border border-line bg-ink px-2 py-1.5 text-sm" />
      </div>
      <fieldset className="space-y-1 max-h-48 overflow-auto text-sm">
        <legend className="text-xs text-muted mb-1">Parts this supplier provides</legend>
        {parts.map((p) => (
          <label key={p.id} className="flex gap-2">
            <input type="checkbox" name="partIds" value={p.id} /> {p.label} {p.supplierName ? <span className="text-muted">({p.supplierName})</span> : null}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted">The supplier gets an email with a private upload link (expires in 30 days) and reminders on days 3, 7 and 14.</p>
      {err ? <p className="text-sm text-gap">{err}</p> : null}
      <button disabled={busy} className="rounded bg-paper text-ink px-3 py-1.5 text-sm font-medium disabled:opacity-50">{busy ? "Sending…" : "Send request"}</button>
    </form>
  );
}
