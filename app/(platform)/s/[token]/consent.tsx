"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Supplier consent to reuse. Off by default. When on, Lodeline may keep the
 * reviewed documents from this link on file and use them for this supplier's
 * other customers, so the supplier does not have to send the same documents
 * again. The supplier can switch it off at any time.
 */
export function ReuseConsent({ token, initial, purpose }: { token: string; initial: boolean; purpose: "pack" | "verification" }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(consent: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/s/${token}/consent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent, name }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? "Could not save your choice.");
      setOn(j.reuseConsent);
      setMsg({ ok: true, text: j.reuseConsent ? "Saved. You can withdraw this at any time." : "Withdrawn. These documents will only be used for this request." });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded border border-line bg-ink-2 p-4 space-y-2">
      <h2 className="font-semibold">Send these documents once</h2>
      <p className="text-sm text-muted">
        {purpose === "verification"
          ? "If you agree, buyers who order a Lodeline evidence pack can see that your reviewed documents are on file, and we can include them in their packs without asking you again."
          : "Other customers may ask you for the same documents. If you agree, Lodeline keeps the reviewed documents from this link on file and can use them in those customers' packs, so you do not have to send them again."}{" "}
        This is optional and off unless you turn it on. You can withdraw it here at any time while this link is active, or by emailing info@lodeline.org.
      </p>
      {on ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ok">Reuse allowed.</span>
          <button disabled={busy} onClick={() => send(false)} className="underline disabled:opacity-50">Withdraw permission</button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void send(true);
          }}
        >
          <label className="space-y-1">
            <span className="block text-muted">Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} className="rounded border border-line bg-ink px-2 py-1" />
          </label>
          <button disabled={busy} className="rounded bg-paper text-ink px-3 py-1.5 font-medium disabled:opacity-50">I agree to reuse</button>
        </form>
      )}
      {msg ? <p className={`text-sm ${msg.ok ? "text-ok" : "text-gap"}`}>{msg.text}</p> : null}
    </section>
  );
}
