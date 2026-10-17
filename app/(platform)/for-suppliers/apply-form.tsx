"use client";
import { useState } from "react";
import Script from "next/script";
import { MATERIALS, STAGES } from "@/domain/types";

const STAGE_LABEL: Record<string, string> = { mine: "Mining", separation: "Separation / refining", metal_alloy: "Metal & alloy", magnet: "Magnet production", component: "Component" };
const MATERIAL_LABEL: Record<string, string> = { ndfeb: "NdFeB", smco: "SmCo", tungsten: "Tungsten", tantalum: "Tantalum", other: "Other" };
const input = "w-full rounded border border-line bg-ink-2 px-3 py-2 text-sm";

export function ApplyForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const [state, setState] = useState<{ kind: "idle" | "busy" | "ok" | "err"; msg?: string }>({ kind: "idle" });

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const fd = new FormData(form);
    const body = {
      companyName: fd.get("companyName"),
      contactName: fd.get("contactName"),
      email: fd.get("email"),
      phone: fd.get("phone"),
      website: fd.get("website"),
      city: fd.get("city"),
      country: fd.get("country"),
      summary: fd.get("summary"),
      documentsNote: fd.get("documentsNote"),
      stages: fd.getAll("stages"),
      materials: fd.getAll("materials"),
      botcheck: fd.get("botcheck") ? "1" : undefined,
      turnstileToken: fd.get("cf-turnstile-response") ?? undefined,
    };
    setState({ kind: "busy" });
    const res = await fetch("/api/supplier-applications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setState({ kind: "err", msg: json?.error?.message ?? "Sorry, that did not go through. Please try again." });
    form.reset();
    setState({ kind: "ok" });
  }

  if (state.kind === "ok")
    return (
      <div className="rounded border border-ok/60 bg-ok/10 p-6 space-y-2">
        <h2 className="font-semibold">Application received.</h2>
        <p className="text-sm text-muted">We will review it and reply by email. Your listing stays unpublished until we have reviewed supporting documents.</p>
      </div>
    );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded border border-line p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Company<input name="companyName" required maxLength={200} className={input} /></label>
        <label className="space-y-1 text-sm">Contact name<input name="contactName" required maxLength={100} className={input} /></label>
        <label className="space-y-1 text-sm">Work email<input name="email" type="email" required maxLength={200} className={input} /></label>
        <label className="space-y-1 text-sm">Phone (optional)<input name="phone" type="tel" maxLength={40} className={input} /></label>
        <label className="space-y-1 text-sm">Website (optional)<input name="website" type="url" placeholder="https://" maxLength={300} className={input} /></label>
        <label className="space-y-1 text-sm">City (optional)<input name="city" maxLength={120} className={input} /></label>
        <label className="space-y-1 text-sm sm:col-span-2">Country of the facility<input name="country" maxLength={80} placeholder="e.g. United States or US" className={input} /></label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm">Stages you perform</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {STAGES.map((s) => (
            <label key={s} className="flex items-center gap-2"><input type="checkbox" name="stages" value={s} />{STAGE_LABEL[s]}</label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm">Materials</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {MATERIALS.map((m) => (
            <label key={m} className="flex items-center gap-2"><input type="checkbox" name="materials" value={m} />{MATERIAL_LABEL[m]}</label>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1 text-sm">What you produce<textarea name="summary" required rows={4} maxLength={2000} className={input} placeholder="Products, capacity, the stages your documents cover" /></label>
      <label className="block space-y-1 text-sm">Origin documents you can provide (optional)<textarea name="documentsNote" rows={3} maxLength={2000} className={input} placeholder="e.g. mine origin statements, refinery certificates, certificates of origin" /></label>
      <p className="text-xs text-gap">Text only. Do not include drawings, controlled technical data or export-controlled information. We request documents later through a private upload link.</p>
      <div className="hidden" aria-hidden="true"><label>Leave this empty<input type="checkbox" name="botcheck" tabIndex={-1} autoComplete="off" /></label></div>
      {turnstileSiteKey ? (
        <>
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
          <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />
        </>
      ) : null}
      {state.kind === "err" ? <p className="text-sm text-gap" role="status">{state.msg}</p> : null}
      <button disabled={state.kind === "busy"} className="rounded bg-accent text-ink px-4 py-2 font-medium disabled:opacity-50">
        {state.kind === "busy" ? "Sending…" : "Apply to be listed"}
      </button>
    </form>
  );
}
