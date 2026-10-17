"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const REASONS: Record<string, string> = {
  technical_drawing: "This looks like a technical drawing. Please send origin certificates or declarations only.",
  export_controlled_marking: "This document carries an export-control marking. Please do not send controlled data.",
  cad_file: "CAD files are not accepted.",
  not_pdf: "Only PDF files are accepted.",
  unreadable_pdf: "The PDF could not be read.",
};

export function SupplierUpload({ token, turnstileSiteKey }: { token: string; turnstileSiteKey?: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
        if (!file) return;
        setBusy(true);
        setMsg(null);
        try {
          const turnstileToken = (form.elements.namedItem("cf-turnstile-response") as HTMLInputElement | null)?.value;
          const r1 = await fetch(`/api/s/${token}/uploads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, turnstileToken }) });
          const j1 = await r1.json();
          if (!r1.ok) throw new Error(j1?.error?.message ?? "Upload refused.");
          const put = await fetch(j1.upload.url, { method: "PUT", headers: j1.upload.headers, body: file });
          if (!put.ok) throw new Error("Upload to storage failed. Please try again.");
          const r2 = await fetch(`/api/s/${token}/documents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: j1.documentId }) });
          const j2 = await r2.json();
          if (!r2.ok) throw new Error(j2?.error?.message ?? "Processing failed.");
          if (j2.status === "rejected") setMsg({ ok: false, text: REASONS[j2.rejectionReason] ?? "The document was not accepted." });
          else setMsg({ ok: true, text: "Thank you. The document was received and will be reviewed." });
          form.reset();
          router.refresh();
        } catch (err) {
          setMsg({ ok: false, text: (err as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      <input name="file" type="file" accept="application/pdf,.pdf" required className="block text-sm" />
      {turnstileSiteKey ? (
        <>
          <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
          <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />
        </>
      ) : null}
      <button disabled={busy} className="rounded bg-paper text-ink px-4 py-2 font-medium disabled:opacity-50">{busy ? "Uploading…" : "Upload PDF"}</button>
      {msg ? <p className={`text-sm ${msg.ok ? "text-ok" : "text-gap"}`}>{msg.text}</p> : null}
    </form>
  );
}
