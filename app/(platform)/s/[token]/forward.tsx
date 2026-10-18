"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Forward a stage up the chain: the supplier names its own upstream supplier,
 * who gets a private link for just that stage.
 */
export function ForwardStage({ token, stage, stageLabel }: { token: string; stage: string; stageLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm underline text-muted">
        We buy this from another supplier: forward this stage to them
      </button>
    );
  }
  return (
    <form
      className="grid gap-2 sm:grid-cols-2 text-sm rounded border border-line p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setMsg(null);
        try {
          const r = await fetch(`/api/s/${token}/forward`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ stages: [stage], name: f.get("name"), contactEmail: f.get("contactEmail"), contactName: f.get("contactName"), country: f.get("country") }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.error?.message ?? "Could not forward the request.");
          setMsg({ ok: true, text: `Forwarded. ${String(f.get("name"))} will get its own private link for ${stageLabel}.` });
          router.refresh();
        } catch (err) {
          setMsg({ ok: false, text: (err as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="sm:col-span-2 text-muted">Who supplies you for {stageLabel}? They get a private upload link for this stage only, for the same parts.</p>
      <input name="name" required placeholder="Supplier company" className="rounded border border-line bg-ink-2 px-2 py-1" />
      <input name="contactEmail" type="email" required placeholder="Contact email" className="rounded border border-line bg-ink-2 px-2 py-1" />
      <input name="contactName" placeholder="Contact name (optional)" className="rounded border border-line bg-ink-2 px-2 py-1" />
      <input name="country" placeholder="Country (optional)" className="rounded border border-line bg-ink-2 px-2 py-1" />
      <div className="sm:col-span-2 flex gap-3 items-center">
        <button disabled={busy} className="rounded bg-paper text-ink px-3 py-1 font-medium disabled:opacity-50">{busy ? "Sending…" : "Forward request"}</button>
        <button type="button" onClick={() => setOpen(false)} className="underline text-muted">Cancel</button>
      </div>
      {msg ? <p className={`sm:col-span-2 ${msg.ok ? "text-ok" : "text-gap"}`}>{msg.text}</p> : null}
    </form>
  );
}
