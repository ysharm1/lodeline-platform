"use client";
import { useState } from "react";

interface Row { id: string; name: string; countryIso: string | null; isExample: boolean; verified: boolean }

export function AskBox() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ answer: string; citedIds: string[]; listings: Row[]; mode: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="rounded border border-line bg-ink-2 p-4 space-y-3">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          const r = await fetch("/api/suppliers/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
          const j = await r.json().catch(() => ({}));
          setBusy(false);
          if (!r.ok) return setErr(j?.error?.message ?? "Failed");
          setRes(j);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder='Ask, e.g. "verified NdFeB separation outside China"' className="flex-1 rounded border border-line bg-ink px-3 py-2 text-sm" />
        <button disabled={busy || !q.trim()} className="rounded bg-paper text-ink px-4 py-2 text-sm font-medium disabled:opacity-50">{busy ? "…" : "Ask"}</button>
      </form>
      {err ? <p className="text-sm text-gap">{err}</p> : null}
      {res ? (
        <div className="space-y-2 text-sm">
          <p className="whitespace-pre-wrap">{res.answer}</p>
          <ol className="list-decimal pl-5 text-muted">
            {res.listings.map((l) => (
              <li key={l.id} className={res.citedIds.includes(l.id) ? "" : "opacity-60"}>
                <a className="underline" href={`/suppliers/${l.id}`}>{l.name}</a> {l.countryIso ? `(${l.countryIso})` : ""} {l.verified ? "· verified" : ""} {l.isExample ? "· example" : ""}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted">Answers come only from directory listings shown above ({res.mode === "llm" ? "AI-assisted" : "keyword"} search). Not an endorsement or certification.</p>
        </div>
      ) : null}
    </div>
  );
}
