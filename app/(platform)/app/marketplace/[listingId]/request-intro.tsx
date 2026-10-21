"use client";
import { useState } from "react";

/** Asks Lodeline for an introduction. Lodeline staff make it; no contact details are shown here. */
export function RequestIntro({ listingId, disabledReason }: { listingId: string; disabledReason?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (disabledReason) return <p className="text-sm text-muted">{disabledReason}</p>;
  return (
    <form
      className="space-y-2 rounded border border-line bg-ink-2 p-4 text-sm"
      data-testid="request-intro"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setMsg(null);
        const r = await fetch("/api/intros", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listingId, message: f.get("message") }) });
        const j = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok) return setMsg({ ok: false, text: j?.error?.message ?? "Could not send the request." });
        setMsg({ ok: true, text: j.duplicate ? "You already have an open request for this supplier. Lodeline will be in touch." : "Request sent. Lodeline will make the introduction by email." });
      }}
    >
      <label className="block text-muted" htmlFor="intro-message">What do you need? (part type, material, stage, volume; no drawings or controlled data)</label>
      <textarea id="intro-message" name="message" maxLength={2000} rows={3} className="w-full rounded border border-line bg-ink px-2 py-1" />
      <div className="flex items-center gap-3">
        <button disabled={busy} className="rounded bg-paper text-ink px-3 py-1.5 font-medium disabled:opacity-50">{busy ? "Sending…" : "Request intro"}</button>
        {msg ? <span className={msg.ok ? "text-ok" : "text-gap"}>{msg.text}</span> : null}
      </div>
    </form>
  );
}
