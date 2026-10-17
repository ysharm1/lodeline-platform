"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function UploadForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/audits", { method: "POST", body: new FormData(e.currentTarget) });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Upload failed.");
      router.push(`/audit/${body.auditId}?t=${encodeURIComponent(body.accessToken)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-xl">
      <label className="block space-y-1">
        <span className="text-sm">Work email</span>
        <input name="email" type="email" required className="w-full rounded border border-line bg-ink-2 px-3 py-2" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm">Company (optional)</span>
        <input name="company" className="w-full rounded border border-line bg-ink-2 px-3 py-2" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm">Parts list (.csv or .xlsx, up to 5 MB / 2,000 rows)</span>
        <input name="file" type="file" required accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="block text-sm" />
      </label>
      {/* Honeypot: real users leave this empty. */}
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {turnstileSiteKey ? (
        <>
          <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
          <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />
        </>
      ) : null}
      {error ? <p className="text-sm text-gap">{error}</p> : null}
      <button disabled={busy} className="rounded bg-paper text-ink px-4 py-2 font-medium disabled:opacity-50">
        {busy ? "Analysing…" : "Run free audit"}
      </button>
    </form>
  );
}
