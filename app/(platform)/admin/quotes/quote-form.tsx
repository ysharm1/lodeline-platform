"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Admin: set the fixed Custom price (USD) and supplier allowance for one audit. */
export function QuoteForm({ auditId, suppliers, current }: { auditId: string; suppliers: number; current: number | null }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setErr(null);
        const r = await fetch(`/api/admin/audits/${auditId}/quote`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ priceCents: Math.round(Number(f.get("usd")) * 100), maxSuppliers: Number(f.get("maxSuppliers")) }),
        });
        const j = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok) return setErr(j?.error?.message ?? "Could not save the quote.");
        router.refresh();
      }}
    >
      <label className="space-y-1">
        <span className="block text-muted text-xs">Fixed fee (USD)</span>
        <input name="usd" type="number" min={5000} step={100} required defaultValue={current ? current / 100 : 7500} className="w-28 rounded border border-line bg-ink px-2 py-1" />
      </label>
      <label className="space-y-1">
        <span className="block text-muted text-xs">Suppliers</span>
        <input name="maxSuppliers" type="number" min={1} required defaultValue={suppliers || 1} className="w-20 rounded border border-line bg-ink px-2 py-1" />
      </label>
      <button disabled={busy} className="rounded bg-paper text-ink px-3 py-1 font-medium disabled:opacity-50">{current ? "Update quote" : "Set quote"}</button>
      {err ? <span className="text-xs text-gap">{err}</span> : null}
    </form>
  );
}
