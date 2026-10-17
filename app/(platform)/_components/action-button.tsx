"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** POSTs JSON; follows `checkoutUrl`/`redirect` in the response, else refreshes. 401 -> login with next. */
export function ActionButton({ url, body, label, method = "POST", confirm, className }: { url: string; body?: unknown; label: string; method?: string; confirm?: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        disabled={busy}
        className={className ?? "rounded bg-paper text-ink px-3 py-1.5 text-sm font-medium disabled:opacity-50"}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setErr(null);
          const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
          const json = await res.json().catch(() => ({}));
          if (res.status === 401) {
            window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
            return;
          }
          setBusy(false);
          if (!res.ok) return setErr(json?.error?.message ?? "Request failed.");
          if (json.checkoutUrl) window.location.href = json.checkoutUrl;
          else router.refresh();
        }}
      >
        {busy ? "Working…" : label}
      </button>
      {err ? <span className="text-xs text-gap">{err}</span> : null}
    </span>
  );
}
