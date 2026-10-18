"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { VERIFICATION_TIERS, usd } from "@/services/pricing";

/** Admin form: start a paid verification for a listing. The supplier is emailed the payment link. */
export function StartVerificationForm({ listings }: { listings: { id: string; name: string; email: string | null; contact: string | null }[] }) {
  const router = useRouter();
  const [listingId, setListingId] = useState(listings[0]?.id ?? "");
  const pick = listings.find((l) => l.id === listingId);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!listings.length) return <p className="text-sm text-muted">No listings yet. Approve a supplier application first.</p>;
  return (
    <form
      key={listingId}
      className="grid gap-3 sm:grid-cols-5 items-end text-sm rounded border border-line bg-ink-2 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setMsg(null);
        const r = await fetch(`/api/admin/listings/${listingId}/verification`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contactEmail: f.get("contactEmail"), contactName: f.get("contactName"), facilities: Number(f.get("facilities")) }),
        });
        const j = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok) return setMsg({ ok: false, text: j?.error?.message ?? "Could not start the verification." });
        setMsg({ ok: true, text: `Started: ${usd(j.priceCents)}. Payment link emailed to the supplier.` });
        router.refresh();
      }}
    >
      <label className="space-y-1 sm:col-span-2">
        <span className="block text-muted">Listing</span>
        <select value={listingId} onChange={(e) => setListingId(e.target.value)} className="w-full rounded border border-line bg-ink px-2 py-1">
          {listings.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-muted">Supplier email</span>
        <input name="contactEmail" type="email" required defaultValue={pick?.email ?? ""} className="w-full rounded border border-line bg-ink px-2 py-1" />
      </label>
      <label className="space-y-1">
        <span className="block text-muted">Contact name</span>
        <input name="contactName" defaultValue={pick?.contact ?? ""} className="w-full rounded border border-line bg-ink px-2 py-1" />
      </label>
      <label className="space-y-1">
        <span className="block text-muted">Facilities</span>
        <select name="facilities" defaultValue="1" className="w-full rounded border border-line bg-ink px-2 py-1">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
            const t = VERIFICATION_TIERS.find((x) => n <= x.maxFacilities)!;
            return <option key={n} value={n}>{n} ({usd(t.priceCents)}/yr)</option>;
          })}
        </select>
      </label>
      <div className="sm:col-span-5 flex items-center gap-3">
        <button disabled={busy} className="rounded bg-paper text-ink px-3 py-1.5 font-medium disabled:opacity-50">{busy ? "Working…" : "Start verification and email payment link"}</button>
        {msg ? <span className={msg.ok ? "text-ok" : "text-gap"}>{msg.text}</span> : null}
      </div>
    </form>
  );
}
